import { stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { Connection, Database, type QueryResult } from "kuzu";

import { configPath, readConfig } from "./config.js";
import { getKuzuDatabasePath } from "./store.js";
import type { LuaGraphQueryResult, QueryCallEdge, QueryNode, QuerySymbolNode } from "./types.js";

export type QueryProjectOptions = {
  readonly depth?: number;
};

type QueryTerm = {
  readonly key: "name" | "kind" | "callers" | "callees";
  readonly value: string;
};

type RelationQueryTerm = QueryTerm & {
  readonly key: "callers" | "callees";
};

type ParsedExpression = {
  readonly source: string;
  readonly terms: readonly QueryTerm[];
};

type GraphData = {
  readonly nodes: readonly QueryNode[];
  readonly symbols: readonly QuerySymbolNode[];
  readonly calls: readonly QueryCallEdge[];
};

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

  const graph = await readGraph(databasePath);
  const { nodes, edges } = evaluateExpression(parsedExpression, graph, depth);

  return {
    projectRoot: resolvedProjectRoot,
    expression: parsedExpression.source,
    count: nodes.length,
    nodes,
    edges,
  };
}

function parseQueryExpression(expression: string): ParsedExpression {
  const source = expression.trim();
  const terms = source.length === 0 ? [] : source.split(/\s+/).map(parseQueryTerm);
  const relationTermCount = terms.filter((term) => term.key === "callers" || term.key === "callees").length;

  if (terms.length === 0) {
    throw new Error("query 表达式不能为空");
  }

  if (relationTermCount > 1) {
    throw new Error("query 表达式只能包含一个 callers 或 callees 条件");
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

  if (key !== "name" && key !== "kind" && key !== "callers" && key !== "callees") {
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

async function assertIndexedDatabase(databasePath: string): Promise<void> {
  if (!(await pathExists(databasePath))) {
    throw new Error("项目尚未 index：缺少 Kuzu 数据库");
  }
}

async function readGraph(databasePath: string): Promise<GraphData> {
  const database = new Database(databasePath, undefined, undefined, true);
  const connection = new Connection(database);

  try {
    const files = await readFileNodes(connection);
    const symbols = await readSymbolNodes(connection);
    const calls = await readCallEdges(connection);

    return {
      nodes: [...files, ...symbols],
      symbols,
      calls,
    };
  } finally {
    await connection.close();
    await database.close();
  }
}

async function readFileNodes(connection: Connection): Promise<QueryNode[]> {
  const rows = await queryRows(connection, "MATCH (file:File) RETURN file.path AS path;");

  return rows.map((row) => {
    const path = readString(row.path, "path");

    return {
      type: "File",
      id: path,
      kind: "file",
      name: basename(path),
      path,
    };
  });
}

async function readSymbolNodes(connection: Connection): Promise<QuerySymbolNode[]> {
  const rows = await queryRows(
    connection,
    `MATCH (symbol:Symbol)
RETURN symbol.id AS id, symbol.kind AS kind, symbol.name AS name,
  symbol.qualifiedName AS qualifiedName, symbol.filePath AS filePath,
  symbol.startLine AS startLine, symbol.signature AS signature;`,
  );

  return rows.map((row) => ({
    type: "Symbol",
    id: readString(row.id, "id"),
    kind: readString(row.kind, "kind"),
    name: readString(row.name, "name"),
    qualifiedName: readString(row.qualifiedName, "qualifiedName"),
    filePath: readString(row.filePath, "filePath"),
    startLine: readNumber(row.startLine, "startLine"),
    signature: readString(row.signature, "signature"),
  }));
}

async function readCallEdges(connection: Connection): Promise<QueryCallEdge[]> {
  const rows = await queryRows(
    connection,
    `MATCH (source:Symbol)-[call:Calls]->(target:Symbol)
RETURN source.id AS source, target.id AS target, call.line AS line,
  call.\`column\` AS callColumn, call.isResolved AS isResolved;`,
  );

  return rows.map((row) => ({
    kind: "Calls",
    source: readString(row.source, "source"),
    target: readString(row.target, "target"),
    line: readNumber(row.line, "line"),
    column: readNumber(row.callColumn, "callColumn"),
    isResolved: readBoolean(row.isResolved, "isResolved"),
  }));
}

function evaluateExpression(
  expression: ParsedExpression,
  graph: GraphData,
  depth: number,
): Pick<LuaGraphQueryResult, "nodes" | "edges"> {
  const relationTerm = expression.terms.find(isRelationTerm);

  if (relationTerm !== undefined) {
    return evaluateRelationTerm(relationTerm, expression.terms, graph, depth);
  }

  return {
    nodes: sortNodes(graph.nodes.filter((node) => matchesTerms(node, expression.terms))),
    edges: [],
  };
}

function evaluateRelationTerm(
  relationTerm: RelationQueryTerm,
  terms: readonly QueryTerm[],
  graph: GraphData,
  depth: number,
): Pick<LuaGraphQueryResult, "nodes" | "edges"> {
  const seeds = graph.symbols.filter((symbol) => matchesName(symbol, relationTerm.value));
  const seedIds = new Set(seeds.map((symbol) => symbol.id));
  const traversedEdges = collectRelationEdges(relationTerm.key, seedIds, graph.calls, depth);
  const resultIds = new Set(
    traversedEdges.map((edge) => (relationTerm.key === "callers" ? edge.source : edge.target)),
  );
  const filteredTerms = terms.filter((term) => term !== relationTerm);
  const nodes = graph.symbols.filter((symbol) => resultIds.has(symbol.id) && matchesTerms(symbol, filteredTerms));

  return {
    nodes: sortNodes(nodes),
    edges: sortEdges(traversedEdges.filter((edge) => hasResultEndpoint(edge, relationTerm.key, resultIds))),
  };
}

function isRelationTerm(term: QueryTerm): term is RelationQueryTerm {
  return term.key === "callers" || term.key === "callees";
}

function collectRelationEdges(
  relation: "callers" | "callees",
  seedIds: ReadonlySet<string>,
  calls: readonly QueryCallEdge[],
  depth: number,
): readonly QueryCallEdge[] {
  const edges: QueryCallEdge[] = [];
  let frontier = new Set(seedIds);
  const visited = new Set(seedIds);

  for (let level = 0; level < depth; level += 1) {
    const nextFrontier = new Set<string>();

    for (const edge of calls) {
      const origin = relation === "callers" ? edge.target : edge.source;
      const next = relation === "callers" ? edge.source : edge.target;

      if (!frontier.has(origin)) {
        continue;
      }

      edges.push(edge);
      if (!visited.has(next)) {
        visited.add(next);
        nextFrontier.add(next);
      }
    }

    frontier = nextFrontier;
  }

  return edges;
}

function hasResultEndpoint(
  edge: QueryCallEdge,
  relation: "callers" | "callees",
  resultIds: ReadonlySet<string>,
): boolean {
  return resultIds.has(relation === "callers" ? edge.source : edge.target);
}

function matchesTerms(node: QueryNode, terms: readonly QueryTerm[]): boolean {
  return terms.every((term) => matchesTerm(node, term));
}

function matchesTerm(node: QueryNode, term: QueryTerm): boolean {
  if (term.key === "name") {
    return matchesName(node, term.value);
  }

  if (term.key === "kind") {
    return node.kind === term.value;
  }

  return true;
}

function matchesName(node: QueryNode, value: string): boolean {
  if (node.type === "File") {
    return node.name === value || node.path === value;
  }

  return node.name === value || node.qualifiedName === value;
}

async function queryRows(connection: Connection, cypher: string): Promise<Record<string, unknown>[]> {
  let result: QueryResult | QueryResult[] | undefined;

  try {
    result = await connection.query(cypher);
    const queryResult = Array.isArray(result) ? result[0] : result;
    if (queryResult === undefined) {
      throw new Error("query 查询未返回结果");
    }

    return (await queryResult.getAll()) as Record<string, unknown>[];
  } finally {
    closeQueryResult(result);
  }
}

function sortNodes(nodes: readonly QueryNode[]): QueryNode[] {
  return [...nodes].sort((left, right) => nodeSortKey(left).localeCompare(nodeSortKey(right)));
}

function sortEdges(edges: readonly QueryCallEdge[]): QueryCallEdge[] {
  return [...edges].sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.target.localeCompare(right.target) ||
      left.line - right.line ||
      left.column - right.column,
  );
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
