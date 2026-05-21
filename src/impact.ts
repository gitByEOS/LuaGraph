import { stat } from "node:fs/promises";
import nodePath from "node:path";

import { Connection, Database, type KuzuValue, type QueryResult } from "kuzu";

import { configPath, readConfig } from "./config.js";
import { normalizeRepositoryPath } from "./path.js";
import { getKuzuDatabasePath } from "./store.js";
import type { LuaGraphImpactResult, QueryCallEdge, QueryEdge, QueryRequireEdge, QuerySymbolNode } from "./types.js";

export type ImpactProjectOptions = {
  readonly depth?: number;
};

type QueryParameters = Record<string, KuzuValue>;

export async function impactProject(
  projectRoot: string,
  input: string,
  options: ImpactProjectOptions = {},
): Promise<LuaGraphImpactResult> {
  const resolvedProjectRoot = nodePath.resolve(projectRoot);
  const depth = normalizeDepth(options.depth ?? 2);
  const config = await readConfig(resolvedProjectRoot);

  if (config === undefined) {
    throw new Error(`项目尚未 init：缺少 ${nodePath.join(resolvedProjectRoot, configPath)}`);
  }

  const databasePath = getKuzuDatabasePath(nodePath.resolve(resolvedProjectRoot, config.databaseDir));
  await assertIndexedDatabase(databasePath);

  const database = new Database(databasePath, undefined, undefined, true);
  const connection = new Connection(database);

  try {
    const inputFilePath = normalizeInputFilePath(resolvedProjectRoot, input);
    const seeds = await querySeeds(connection, resolvedProjectRoot, input);
    const { nodes, edges } = await queryImpactCallers(connection, seeds, depth);
    const requireImpact =
      inputFilePath !== undefined && (await hasFile(connection, inputFilePath))
        ? await queryImpactDependents(connection, inputFilePath, depth)
        : { files: [], edges: [] };
    const files = sortStrings([...new Set([...nodes.map((node) => node.filePath), ...requireImpact.files])]);

    return {
      projectRoot: resolvedProjectRoot,
      input,
      depth,
      seeds,
      count: nodes.length + requireImpact.files.length,
      nodes,
      files,
      edges: sortEdges([...edges, ...requireImpact.edges]),
    };
  } finally {
    await connection.close();
    await database.close();
  }
}

async function queryImpactDependents(
  connection: Connection,
  filePath: string,
  depth: number,
): Promise<{ readonly files: string[]; readonly edges: QueryRequireEdge[] }> {
  const files = new Set<string>();
  const edgesByKey = new Map<string, QueryRequireEdge>();
  const visited = new Set([filePath]);
  let frontier = [filePath];

  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const nextFrontier: string[] = [];

    for (const targetPath of frontier) {
      const rows = await queryDependentRows(connection, targetPath);

      for (const row of rows) {
        const edge = toRequireEdge(row);
        files.add(edge.source);
        edgesByKey.set(edgeKey(edge), edge);

        if (!visited.has(edge.source)) {
          visited.add(edge.source);
          nextFrontier.push(edge.source);
        }
      }
    }

    frontier = sortStrings(nextFrontier);
  }

  return {
    files: sortStrings([...files]),
    edges: sortEdges([...edgesByKey.values()]).filter((edge): edge is QueryRequireEdge => edge.kind === "Requires"),
  };
}

function normalizeDepth(depth: number): number {
  if (!Number.isInteger(depth) || depth < 1) {
    throw new Error("impact --depth 必须是正整数");
  }

  return depth;
}

async function querySeeds(
  connection: Connection,
  projectRoot: string,
  input: string,
): Promise<QuerySymbolNode[]> {
  const filePath = normalizeInputFilePath(projectRoot, input);

  if (filePath !== undefined && (await hasFile(connection, filePath))) {
    return querySymbolsInFile(connection, filePath);
  }

  return querySymbolsByName(connection, input);
}

function normalizeInputFilePath(projectRoot: string, input: string): string | undefined {
  if (!looksLikeFilePath(input)) {
    return undefined;
  }

  const relativePath = nodePath.isAbsolute(input) ? nodePath.relative(projectRoot, input) : input;

  return normalizeRepositoryPath(relativePath);
}

function looksLikeFilePath(input: string): boolean {
  return input.endsWith(".lua") || input.includes("/") || input.includes("\\");
}

async function hasFile(connection: Connection, filePath: string): Promise<boolean> {
  const rows = await queryRows(
    connection,
    "MATCH (file:File) WHERE file.path = $path RETURN file.path AS path;",
    { path: filePath },
  );

  return rows.length > 0;
}

async function querySymbolsInFile(
  connection: Connection,
  filePath: string,
): Promise<QuerySymbolNode[]> {
  const rows = await queryRows(
    connection,
    `MATCH (symbol:Symbol)
WHERE symbol.filePath = $filePath
RETURN symbol.id AS id, symbol.kind AS kind, symbol.name AS name,
  symbol.qualifiedName AS qualifiedName, symbol.filePath AS filePath,
  symbol.startLine AS startLine, symbol.signature AS signature;`,
    { filePath },
  );

  return sortSymbols(rows.map(toSymbolNode));
}

async function querySymbolsByName(
  connection: Connection,
  name: string,
): Promise<QuerySymbolNode[]> {
  const rows = await queryRows(
    connection,
    `MATCH (symbol:Symbol)
WHERE symbol.name = $name OR symbol.qualifiedName = $name
RETURN symbol.id AS id, symbol.kind AS kind, symbol.name AS name,
  symbol.qualifiedName AS qualifiedName, symbol.filePath AS filePath,
  symbol.startLine AS startLine, symbol.signature AS signature;`,
    { name },
  );

  return sortSymbols(rows.map(toSymbolNode));
}

async function queryImpactCallers(
  connection: Connection,
  seeds: readonly QuerySymbolNode[],
  depth: number,
): Promise<{ readonly nodes: QuerySymbolNode[]; readonly edges: QueryCallEdge[] }> {
  const nodesById = new Map<string, QuerySymbolNode>();
  const edgesByKey = new Map<string, QueryCallEdge>();
  const visited = new Set(seeds.map((seed) => seed.id));
  let frontier = seeds.map((seed) => seed.id);

  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const nextFrontier: string[] = [];

    for (const targetId of frontier) {
      const rows = await queryCallerRows(connection, targetId);

      for (const row of rows) {
        const node = toSymbolNode(row);

        if (visited.has(node.id)) {
          continue;
        }

        const edge = toCallEdge(row);
        visited.add(node.id);
        nodesById.set(node.id, node);
        edgesByKey.set(edgeKey(edge), edge);
        nextFrontier.push(node.id);
      }
    }

    frontier = sortStrings(nextFrontier);
  }

  return {
    nodes: sortSymbols([...nodesById.values()]),
    edges: sortEdges([...edgesByKey.values()]).filter((edge): edge is QueryCallEdge => edge.kind === "Calls"),
  };
}

async function queryCallerRows(
  connection: Connection,
  targetId: string,
): Promise<Record<string, unknown>[]> {
  return queryRows(
    connection,
    `MATCH (caller:Symbol)-[call:Calls]->(target:Symbol)
WHERE target.id = $targetId
RETURN caller.id AS id, caller.kind AS kind, caller.name AS name,
  caller.qualifiedName AS qualifiedName, caller.filePath AS filePath,
  caller.startLine AS startLine, caller.signature AS signature,
  caller.id AS edgeSource, target.id AS edgeTarget, call.line AS line,
  call.\`column\` AS callColumn, call.isResolved AS isResolved;`,
    { targetId },
  );
}

async function queryDependentRows(
  connection: Connection,
  targetPath: string,
): Promise<Record<string, unknown>[]> {
  return queryRows(
    connection,
    `MATCH (source:File)-[require:Requires]->(target:File)
WHERE target.path = $targetPath AND source.path <> target.path
RETURN source.path AS edgeSource, target.path AS edgeTarget,
  require.moduleName AS moduleName, require.isResolved AS isResolved;`,
    { targetPath },
  );
}

async function assertIndexedDatabase(databasePath: string): Promise<void> {
  if (!(await pathExists(databasePath))) {
    throw new Error("项目尚未 index：缺少 Kuzu 数据库");
  }
}

async function queryRows(
  connection: Connection,
  cypher: string,
  parameters: QueryParameters = {},
): Promise<Record<string, unknown>[]> {
  let result: QueryResult | QueryResult[] | undefined;

  try {
    if (Object.keys(parameters).length === 0) {
      result = await connection.query(cypher);
    } else {
      const statement = await connection.prepare(cypher);
      result = await connection.execute(statement, parameters);
    }

    const queryResult = Array.isArray(result) ? result[0] : result;
    if (queryResult === undefined) {
      throw new Error("impact 查询未返回结果");
    }

    return (await queryResult.getAll()) as Record<string, unknown>[];
  } finally {
    closeQueryResult(result);
  }
}

function toSymbolNode(row: Record<string, unknown>): QuerySymbolNode {
  return {
    type: "Symbol",
    id: readString(row.id, "id"),
    kind: readString(row.kind, "kind"),
    name: readString(row.name, "name"),
    qualifiedName: readString(row.qualifiedName, "qualifiedName"),
    filePath: readString(row.filePath, "filePath"),
    startLine: readNumber(row.startLine, "startLine"),
    signature: readString(row.signature, "signature"),
  };
}

function toCallEdge(row: Record<string, unknown>): QueryCallEdge {
  return {
    kind: "Calls",
    source: readString(row.edgeSource, "edgeSource"),
    target: readString(row.edgeTarget, "edgeTarget"),
    line: readNumber(row.line, "line"),
    column: readNumber(row.callColumn, "callColumn"),
    isResolved: readBoolean(row.isResolved, "isResolved"),
  };
}

function toRequireEdge(row: Record<string, unknown>): QueryRequireEdge {
  return {
    kind: "Requires",
    source: readString(row.edgeSource, "edgeSource"),
    target: readString(row.edgeTarget, "edgeTarget"),
    moduleName: readString(row.moduleName, "moduleName"),
    isResolved: readBoolean(row.isResolved, "isResolved"),
  };
}

function edgeKey(edge: QueryEdge): string {
  if (edge.kind === "Requires") {
    return `${edge.kind}:${edge.source}->${edge.target}:${edge.moduleName}`;
  }

  if (edge.kind === "Extends") {
    return `${edge.kind}:${edge.source}->${edge.target}`;
  }

  return `${edge.kind}:${edge.source}->${edge.target}@${edge.line}:${edge.column}`;
}

function sortSymbols(nodes: readonly QuerySymbolNode[]): QuerySymbolNode[] {
  return [...nodes].sort(compareSymbols);
}

function compareSymbols(left: QuerySymbolNode, right: QuerySymbolNode): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.startLine - right.startLine ||
    left.kind.localeCompare(right.kind) ||
    left.qualifiedName.localeCompare(right.qualifiedName)
  );
}

function sortEdges(edges: readonly QueryEdge[]): QueryEdge[] {
  return [...edges].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.source.localeCompare(right.source) ||
      left.target.localeCompare(right.target) ||
      compareEdgeLocation(left, right),
  );
}

function compareEdgeLocation(left: QueryEdge, right: QueryEdge): number {
  if (left.kind === "Extends" || right.kind === "Extends") {
    return 0;
  }

  if (left.kind === "Requires" || right.kind === "Requires") {
    return 0;
  }

  return left.line - right.line || left.column - right.column;
}

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function readString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`impact 查询返回了无效字段：${name}`);
  }

  return value;
}

function readNumber(value: unknown, name: string): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  throw new Error(`impact 查询返回了无效字段：${name}`);
}

function readBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`impact 查询返回了无效字段：${name}`);
  }

  return value;
}

function closeQueryResult(result: QueryResult | QueryResult[] | undefined): void {
  const results = Array.isArray(result) ? result : result === undefined ? [] : [result];

  for (const item of results) {
    item.close();
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
