import { stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { Connection, Database, type KuzuValue, type QueryResult } from "kuzu";

import { configPath, readConfig } from "./config.js";
import { getKuzuDatabasePath } from "./store.js";
import type { LuaGraphQueryResult, QueryEdge, QueryNode, QueryRequireEdge, QuerySymbolNode } from "./project-types.js";

export type QueryProjectOptions = {
  readonly depth?: number;
};

type FilterQueryTerm = {
  readonly key: "name" | "kind";
  readonly value: string;
};

type CallRelationQueryTerm = {
  readonly key: "callers" | "callees";
  readonly value: string;
};

type RequireRelationQueryTerm = {
  readonly key: "requires" | "dependents";
  readonly value: string;
};

type ExtendsRelationQueryTerm = {
  readonly key: "extends" | "subclasses";
  readonly value: string;
};

type MethodsRelationQueryTerm = {
  readonly key: "methods";
  readonly value: string;
};

type RelationQueryTerm = CallRelationQueryTerm | ExtendsRelationQueryTerm | RequireRelationQueryTerm | MethodsRelationQueryTerm;
type QueryTerm = FilterQueryTerm | RelationQueryTerm;
type RelationKey = RelationQueryTerm["key"];
type SymbolRelationKey = CallRelationQueryTerm["key"] | ExtendsRelationQueryTerm["key"];

type ParsedExpression = {
  readonly source: string;
  readonly terms: readonly QueryTerm[];
};

type QueryFilters = {
  readonly name?: string;
  readonly kind?: string;
};

type QueryParameters = Record<string, KuzuValue>;
type SymbolRow = Record<string, unknown>;

export async function queryProject(
  projectRoot: string,
  expression: string,
  options: QueryProjectOptions = {},
): Promise<LuaGraphQueryResult> {
  const resolvedProjectRoot = resolve(projectRoot);
  const parsedExpression = parseQueryExpression(expression);
  const depth = normalizeDepth(options.depth ?? 1);
  const config = await readConfig(resolvedProjectRoot);

  if (config === undefined) {
    throw new Error(`项目尚未 init：缺少 ${join(resolvedProjectRoot, configPath)}`);
  }

  const databasePath = getKuzuDatabasePath(resolve(resolvedProjectRoot, config.databaseDir));
  await assertIndexedDatabase(databasePath);

  const database = new Database(databasePath, undefined, undefined, true);
  const connection = new Connection(database);

  try {
    const { nodes, edges } = await executeQuery(connection, parsedExpression, depth);

    return {
      projectRoot: resolvedProjectRoot,
      expression: parsedExpression.source,
      count: nodes.length,
      nodes,
      edges,
    };
  } finally {
    await connection.close();
    await database.close();
  }
}

function parseQueryExpression(expression: string): ParsedExpression {
  const source = expression.trim();
  const terms = source.length === 0 ? [] : source.split(/\s+/).map(parseQueryTerm);
  const relationTermCount = terms.filter(isRelationTerm).length;

  if (terms.length === 0) {
    throw new Error("query 表达式不能为空");
  }

  if (relationTermCount > 1) {
    throw new Error("query 表达式只能包含一个 callers、callees、extends、subclasses、requires、dependents 或 methods 条件");
  }

  return { source, terms };
}

function parseQueryTerm(token: string): QueryTerm {
  const separatorIndex = token.indexOf(":");

  if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
    throw new Error(`query 条件无效：${token}`);
  }

  const key = token.slice(0, separatorIndex);
  const value = token.slice(separatorIndex + 1);

  if (
    key !== "name" &&
    key !== "kind" &&
    key !== "callers" &&
    key !== "callees" &&
    key !== "extends" &&
    key !== "subclasses" &&
    key !== "requires" &&
    key !== "dependents" &&
    key !== "methods"
  ) {
    throw new Error(`query 不支持条件：${key}`);
  }

  return { key, value };
}

function normalizeDepth(depth: number): number {
  if (!Number.isInteger(depth) || depth < 1) {
    throw new Error("query --depth 必须是正整数");
  }

  return depth;
}

async function executeQuery(
  connection: Connection,
  expression: ParsedExpression,
  depth: number,
): Promise<Pick<LuaGraphQueryResult, "nodes" | "edges">> {
  const relationTerm = expression.terms.find(isRelationTerm);

  if (relationTerm !== undefined) {
    if (isMethodsRelationTerm(relationTerm)) {
      return executeMethodsQuery(connection, relationTerm);
    }

    if (isRequireRelationTerm(relationTerm)) {
      return executeRequireQuery(connection, relationTerm, depth);
    }

    return executeRelationQuery(connection, relationTerm, createFilters(expression.terms, relationTerm), depth);
  }

  const filters = createFilters(expression.terms);
  const nodes = [
    ...(await queryFileNodes(connection, filters)),
    ...(await querySymbolNodes(connection, filters)),
  ];

  return { nodes: sortNodes(nodes), edges: [] };
}

function createFilters(
  terms: readonly QueryTerm[],
  excludedTerm?: QueryTerm,
): QueryFilters {
  const activeTerms = terms.filter((term) => term !== excludedTerm);

  return {
    ...readFilter(activeTerms, "name"),
    ...readFilter(activeTerms, "kind"),
  };
}

function readFilter(terms: readonly QueryTerm[], key: "name" | "kind"): QueryFilters {
  const term = terms.find((item) => item.key === key);

  return term === undefined ? {} : { [key]: term.value };
}

async function queryFileNodes(
  connection: Connection,
  filters: QueryFilters,
): Promise<QueryNode[]> {
  if (filters.kind !== undefined && filters.kind !== "file") {
    return [];
  }

  if (filters.name !== undefined) {
    const rows = await queryRows(
      connection,
      "MATCH (file:File) WHERE file.path = $name RETURN file.path AS path;",
      { name: filters.name },
    );

    return rows.map(toFileNode);
  }

  if (filters.kind === "file") {
    const rows = await queryRows(connection, "MATCH (file:File) RETURN file.path AS path;");

    return rows.map(toFileNode);
  }

  return [];
}

async function querySymbolNodes(
  connection: Connection,
  filters: QueryFilters,
): Promise<QuerySymbolNode[]> {
  const { whereClause, parameters } = createSymbolWhereClause("symbol", filters);
  const rows = await queryRows(
    connection,
    `MATCH (symbol:Symbol)
${whereClause}
RETURN symbol.id AS id, symbol.kind AS kind, symbol.name AS name,
  symbol.qualifiedName AS qualifiedName, symbol.filePath AS filePath,
  symbol.startLine AS startLine, symbol.signature AS signature;`,
    parameters,
  );

  return rows.map(toSymbolNode);
}

async function executeMethodsQuery(
  connection: Connection,
  relationTerm: MethodsRelationQueryTerm,
): Promise<Pick<LuaGraphQueryResult, "nodes" | "edges">> {
  const rows = await queryRows(
    connection,
    `MATCH (symbol:Symbol)
WHERE symbol.kind = $kind
RETURN symbol.id AS id, symbol.kind AS kind, symbol.name AS name,
  symbol.qualifiedName AS qualifiedName, symbol.filePath AS filePath,
  symbol.startLine AS startLine, symbol.signature AS signature;`,
    { kind: "method" },
  );
  const nodes = rows
    .map(toSymbolNode)
    .filter((node) => isMethodOwnedByType(node.qualifiedName, relationTerm.value));

  return { nodes: sortNodes(nodes), edges: [] };
}

function isMethodOwnedByType(qualifiedName: string, typeName: string): boolean {
  return qualifiedName.startsWith(`${typeName}:`) || qualifiedName.startsWith(`${typeName}.`);
}

async function executeRelationQuery(
  connection: Connection,
  relationTerm: CallRelationQueryTerm | ExtendsRelationQueryTerm,
  filters: QueryFilters,
  depth: number,
): Promise<Pick<LuaGraphQueryResult, "nodes" | "edges">> {
  const seeds = await querySeedSymbols(connection, relationTerm.value);
  const nodesById = new Map<string, QuerySymbolNode>();
  const edgesByKey = new Map<string, QueryEdge>();
  const visited = new Set(seeds.map((symbol) => symbol.id));
  let frontier = seeds.map((symbol) => symbol.id);

  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const nextFrontier: string[] = [];

    for (const originId of frontier) {
      const rows = await queryRelationRows(connection, relationTerm.key, originId, filters);

      for (const row of rows) {
        const node = toSymbolNode(row);
        const edge = toRelationEdge(row, relationTerm.key);

        nodesById.set(node.id, node);
        edgesByKey.set(edgeKey(edge), edge);

        if (!visited.has(node.id)) {
          visited.add(node.id);
          nextFrontier.push(node.id);
        }
      }
    }

    frontier = nextFrontier;
  }

  return {
    nodes: sortNodes([...nodesById.values()]),
    edges: sortEdges([...edgesByKey.values()]),
  };
}

async function executeRequireQuery(
  connection: Connection,
  relationTerm: RequireRelationQueryTerm,
  depth: number,
): Promise<Pick<LuaGraphQueryResult, "nodes" | "edges">> {
  const nodesById = new Map<string, QueryNode>();
  const edgesByKey = new Map<string, QueryRequireEdge>();
  const seedPaths = await queryRequireSeedPaths(connection, relationTerm.value);
  const visited = new Set(seedPaths);
  let frontier = seedPaths;

  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const nextFrontier: string[] = [];

    for (const originPath of frontier) {
      const rows = await queryRequireRows(connection, relationTerm.key, originPath);

      for (const row of rows) {
        const node = toFileNode(row);
        const edge = toRequireEdge(row);

        nodesById.set(node.id, node);
        edgesByKey.set(edgeKey(edge), edge);

        if (!visited.has(node.id)) {
          visited.add(node.id);
          nextFrontier.push(node.id);
        }
      }
    }

    frontier = nextFrontier;
  }

  return {
    nodes: sortNodes([...nodesById.values()]),
    edges: sortEdges([...edgesByKey.values()]),
  };
}

async function queryRequireSeedPaths(connection: Connection, pathQuery: string): Promise<string[]> {
  const rows = await queryRows(connection, "MATCH (file:File) RETURN file.path AS path;");

  return rows
    .map((row) => readString(row.path, "path"))
    .filter((path) => isPathQueryMatched(path, pathQuery))
    .sort((left, right) => left.localeCompare(right));
}

function isPathQueryMatched(path: string, pathQuery: string): boolean {
  const normalizedPath = path.toLowerCase();
  const normalizedQuery = normalizePathQuery(pathQuery);

  if (normalizedQuery === "*") {
    return true;
  }

  return (
    normalizedPath.includes(normalizedQuery) ||
    normalizedQuery.endsWith(`/${normalizedPath}`)
  );
}

function normalizePathQuery(pathQuery: string): string {
  return pathQuery
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .toLowerCase();
}

async function querySeedSymbols(
  connection: Connection,
  name: string,
): Promise<QuerySymbolNode[]> {
  if (name === "*") {
    const rows = await queryRows(
      connection,
      `MATCH (symbol:Symbol)
RETURN symbol.id AS id, symbol.kind AS kind, symbol.name AS name,
  symbol.qualifiedName AS qualifiedName, symbol.filePath AS filePath,
  symbol.startLine AS startLine, symbol.signature AS signature;`,
    );

    return rows.map(toSymbolNode);
  }

  const rows = await queryRows(
    connection,
    `MATCH (symbol:Symbol)
WHERE symbol.name = $name OR symbol.qualifiedName = $name
RETURN symbol.id AS id, symbol.kind AS kind, symbol.name AS name,
  symbol.qualifiedName AS qualifiedName, symbol.filePath AS filePath,
  symbol.startLine AS startLine, symbol.signature AS signature;`,
    { name },
  );

  return rows.map(toSymbolNode);
}

async function queryRelationRows(
  connection: Connection,
  relation: SymbolRelationKey,
  originId: string,
  filters: QueryFilters,
): Promise<SymbolRow[]> {
  const { whereClause, parameters } = createRelationWhereClause(filters);
  const relationMatch = createRelationMatch(relation);

  return queryRows(
    connection,
    `${relationMatch.match}
WHERE origin.id = $originId${whereClause}
RETURN symbol.id AS id, symbol.kind AS kind, symbol.name AS name,
  symbol.qualifiedName AS qualifiedName, symbol.filePath AS filePath,
  symbol.startLine AS startLine, symbol.signature AS signature,
  ${relationMatch.source} AS edgeSource, ${relationMatch.target} AS edgeTarget${relationMatch.edgeFields};`,
    { ...parameters, originId },
  );
}

function createRelationMatch(relation: SymbolRelationKey): {
  readonly match: string;
  readonly source: string;
  readonly target: string;
  readonly edgeFields: string;
} {
  if (relation === "callers") {
    return {
      match: "MATCH (symbol:Symbol)-[call:Calls]->(origin:Symbol)",
      source: "symbol.id",
      target: "origin.id",
      edgeFields: ", call.line AS line, call.`column` AS callColumn, call.isResolved AS isResolved",
    };
  }

  if (relation === "callees") {
    return {
      match: "MATCH (origin:Symbol)-[call:Calls]->(symbol:Symbol)",
      source: "origin.id",
      target: "symbol.id",
      edgeFields: ", call.line AS line, call.`column` AS callColumn, call.isResolved AS isResolved",
    };
  }

  if (relation === "extends") {
    return {
      match: "MATCH (origin:Symbol)-[extend:Extends]->(symbol:Symbol)",
      source: "origin.id",
      target: "symbol.id",
      edgeFields: "",
    };
  }

  return {
    match: "MATCH (symbol:Symbol)-[extend:Extends]->(origin:Symbol)",
    source: "symbol.id",
    target: "origin.id",
    edgeFields: "",
  };
}

async function queryRequireRows(
  connection: Connection,
  relation: "requires" | "dependents",
  originPath: string,
): Promise<Record<string, unknown>[]> {
  const match =
    relation === "requires"
      ? "MATCH (origin:File)-[require:Requires]->(file:File)"
      : "MATCH (file:File)-[require:Requires]->(origin:File)";
  const source = relation === "requires" ? "origin.path" : "file.path";
  const target = relation === "requires" ? "file.path" : "origin.path";

  return queryRows(
    connection,
    `${match}
WHERE origin.path = $originPath
RETURN file.path AS path, ${source} AS edgeSource, ${target} AS edgeTarget,
  require.moduleName AS moduleName, require.isResolved AS isResolved;`,
    { originPath },
  );
}

function createSymbolWhereClause(
  variable: string,
  filters: QueryFilters,
): { readonly whereClause: string; readonly parameters: QueryParameters } {
  const conditions: string[] = [];
  const parameters: QueryParameters = {};

  if (filters.name !== undefined) {
    conditions.push(`(${variable}.name = $name OR ${variable}.qualifiedName = $name)`);
    parameters.name = filters.name;
  }

  if (filters.kind !== undefined) {
    conditions.push(`${variable}.kind = $kind`);
    parameters.kind = filters.kind;
  }

  return {
    whereClause: conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`,
    parameters,
  };
}

function createRelationWhereClause(
  filters: QueryFilters,
): { readonly whereClause: string; readonly parameters: QueryParameters } {
  const { whereClause, parameters } = createSymbolWhereClause("symbol", filters);

  if (whereClause.length === 0) {
    return { whereClause: "", parameters };
  }

  return {
    whereClause: ` AND ${whereClause.slice("WHERE ".length)}`,
    parameters,
  };
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
      throw new Error("query 查询未返回结果");
    }

    return (await queryResult.getAll()) as Record<string, unknown>[];
  } finally {
    closeQueryResult(result);
  }
}

function toFileNode(row: Record<string, unknown>): QueryNode {
  const path = readString(row.path, "path");

  return {
    type: "File",
    id: path,
    kind: "file",
    name: basename(path),
    path,
  };
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

function toRelationEdge(row: Record<string, unknown>, relation: RelationKey): QueryEdge {
  if (relation === "extends" || relation === "subclasses") {
    return {
      kind: "Extends",
      source: readString(row.edgeSource, "edgeSource"),
      target: readString(row.edgeTarget, "edgeTarget"),
    };
  }

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

function isRelationTerm(term: QueryTerm): term is RelationQueryTerm {
  return (
    term.key === "callers" ||
    term.key === "callees" ||
    term.key === "extends" ||
    term.key === "subclasses" ||
    term.key === "requires" ||
    term.key === "dependents" ||
    term.key === "methods"
  );
}

function isRequireRelationTerm(
  term: RelationQueryTerm,
): term is RequireRelationQueryTerm {
  return term.key === "requires" || term.key === "dependents";
}

function isMethodsRelationTerm(
  term: RelationQueryTerm,
): term is MethodsRelationQueryTerm {
  return term.key === "methods";
}

function edgeKey(edge: QueryEdge): string {
  if (edge.kind === "Extends") {
    return `${edge.kind}:${edge.source}->${edge.target}`;
  }

  if (edge.kind === "Requires") {
    return `${edge.kind}:${edge.source}->${edge.target}:${edge.moduleName}`;
  }

  return `${edge.kind}:${edge.source}->${edge.target}@${edge.line}:${edge.column}`;
}

function sortNodes(nodes: readonly QueryNode[]): QueryNode[] {
  return [...nodes].sort((left, right) => nodeSortKey(left).localeCompare(nodeSortKey(right)));
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
    return left.kind.localeCompare(right.kind);
  }

  if (left.kind === "Requires" || right.kind === "Requires") {
    return 0;
  }

  return left.line - right.line || left.column - right.column;
}

function nodeSortKey(node: QueryNode): string {
  if (node.type === "File") {
    return `0:${node.path}`;
  }

  return `1:${node.filePath}:${node.startLine}:${node.kind}:${node.qualifiedName}`;
}

function readString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`query 查询返回了无效字段：${name}`);
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

  throw new Error(`query 查询返回了无效字段：${name}`);
}

function readBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`query 查询返回了无效字段：${name}`);
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
