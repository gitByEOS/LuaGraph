import { readFile, stat } from "node:fs/promises";
import nodePath from "node:path";

import { Connection, Database, type KuzuValue, type QueryResult } from "kuzu";

import { configPath, readConfig } from "./config.js";
import { normalizeRepositoryPath } from "./path.js";
import { getKuzuDatabasePath } from "./store.js";
import type {
  ExplainBranch,
  ExplainDataFlowStep,
  ExplainDependency,
  ExplainEntrypoint,
  ExplainFlow,
  ExplainFlowCall,
  ExplainTarget,
  LuaGraphExplainResult,
} from "./project-types.js";

export type ExplainProjectOptions = {
  readonly depth?: number;
};

type QueryParameters = Record<string, KuzuValue>;

type ExplainSymbol = {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly signature: string;
  readonly isLocal: boolean;
  readonly isExported: boolean;
};

type ExplainCallRow = {
  readonly symbol: ExplainSymbol;
  readonly line: number;
  readonly column: number;
  readonly isResolved: boolean;
};

type ResolvedTarget =
  | {
      readonly type: "file";
      readonly filePath: string;
    }
  | {
      readonly type: "symbol";
      readonly symbol: ExplainSymbol;
    };

export async function explainProject(
  projectRoot: string,
  input: string,
  options: ExplainProjectOptions = {},
): Promise<LuaGraphExplainResult> {
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
    const resolvedTarget = await resolveTarget(connection, resolvedProjectRoot, input);
    const filePath = resolvedTarget.type === "file" ? resolvedTarget.filePath : resolvedTarget.symbol.filePath;
    const source = await readFile(nodePath.join(resolvedProjectRoot, filePath), "utf8");
    const symbols = await querySymbolsInFile(connection, filePath);
    const target = createTarget(resolvedTarget, filePath);
    const entrypoints = await createEntrypoints(connection, symbols, resolvedTarget);
    const flow = await createFlow(connection, entrypoints, depth);
    const branches = parseBranches(source, filePath, symbols);
    const dependencies = await queryDependencies(connection, filePath);
    const dataFlow = createDataFlow(input, filePath, source, entrypoints, flow, resolvedTarget);
    const externalGaps = createExternalGaps(filePath, dependencies, flow);

    return {
      projectRoot: resolvedProjectRoot,
      input,
      depth,
      target,
      entrypoints,
      flow,
      branches,
      dependencies,
      dataFlow,
      externalGaps,
    };
  } finally {
    await connection.close();
    await database.close();
  }
}

async function resolveTarget(
  connection: Connection,
  projectRoot: string,
  input: string,
): Promise<ResolvedTarget> {
  const trimmedInput = input.trim();

  if (trimmedInput.length === 0) {
    throw new Error("explain input 不能为空");
  }

  const filePaths = await queryMatchingFilePaths(connection, projectRoot, trimmedInput);
  const symbols = await querySymbolsByName(connection, trimmedInput);
  const firstFilePath = filePaths[0];
  const firstSymbol = symbols[0];

  if (looksLikeFilePath(trimmedInput) && firstFilePath !== undefined) {
    return { type: "file", filePath: firstFilePath };
  }

  if (firstSymbol !== undefined) {
    return { type: "symbol", symbol: firstSymbol };
  }

  if (firstFilePath !== undefined) {
    return { type: "file", filePath: firstFilePath };
  }

  throw new Error(`explain 未找到目标：${input}`);
}

async function queryMatchingFilePaths(
  connection: Connection,
  projectRoot: string,
  input: string,
): Promise<string[]> {
  const query = normalizeInputPathQuery(projectRoot, input);
  const rows = await queryRows(connection, "MATCH (file:File) RETURN file.path AS path;");

  return rows
    .map((row) => readString(row.path, "path"))
    .filter((filePath) => isPathQueryMatched(filePath, query))
    .sort((left, right) => left.localeCompare(right));
}

function createTarget(resolvedTarget: ResolvedTarget, filePath: string): ExplainTarget {
  if (resolvedTarget.type === "symbol") {
    return {
      type: "symbol",
      name: resolvedTarget.symbol.qualifiedName,
      filePath,
      startLine: resolvedTarget.symbol.startLine,
    };
  }

  return {
    type: "file",
    name: nodePath.basename(filePath),
    filePath,
  };
}

async function createEntrypoints(
  connection: Connection,
  symbols: readonly ExplainSymbol[],
  target: ResolvedTarget,
): Promise<ExplainEntrypoint[]> {
  const counts = new Map<string, number>();

  for (const symbol of symbols) {
    counts.set(symbol.id, await queryExternalCallCount(connection, symbol));
  }

  const candidates = symbols
    .filter((symbol) => symbol.kind === "function" || symbol.kind === "method")
    .filter((symbol) => symbol.isExported || (counts.get(symbol.id) ?? 0) <= 1);
  const fallback = symbols.filter((symbol) => symbol.kind === "function" || symbol.kind === "method");
  const selected = uniqueSymbols(
    target.type === "symbol"
      ? [target.symbol, ...candidates]
      : candidates.length > 0
        ? candidates
        : fallback,
  ).slice(0, 8);

  return selected.map((symbol) => ({
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    kind: symbol.kind,
    filePath: symbol.filePath,
    startLine: symbol.startLine,
    isExported: symbol.isExported,
    externalCallCount: counts.get(symbol.id) ?? 0,
  }));
}

async function createFlow(
  connection: Connection,
  entrypoints: readonly ExplainEntrypoint[],
  depth: number,
): Promise<ExplainFlow[]> {
  const flows: ExplainFlow[] = [];

  for (const entrypoint of entrypoints.slice(0, 5)) {
    const symbols = await querySymbolsByName(connection, entrypoint.qualifiedName);
    const symbol = symbols.find((item) => item.filePath === entrypoint.filePath);

    if (symbol === undefined) {
      continue;
    }

    flows.push({
      entrypoint: entrypoint.qualifiedName,
      filePath: entrypoint.filePath,
      calls: await queryCallTree(connection, symbol, depth, new Set([symbol.id])),
    });
  }

  return flows;
}

async function queryCallTree(
  connection: Connection,
  source: ExplainSymbol,
  depth: number,
  path: Set<string>,
): Promise<ExplainFlowCall[]> {
  if (depth <= 0) {
    return [];
  }

  const callees = await queryCallees(connection, source.id);
  const calls: ExplainFlowCall[] = [];

  for (const callee of callees) {
    const nextPath = new Set(path);
    const nestedCalls = path.has(callee.symbol.id)
      ? []
      : await queryCallTree(connection, callee.symbol, depth - 1, nextPath.add(callee.symbol.id));

    calls.push({
      from: source.qualifiedName,
      to: callee.symbol.qualifiedName,
      filePath: callee.symbol.filePath,
      line: callee.line,
      isResolved: callee.isResolved,
      calls: nestedCalls,
    });
  }

  return calls;
}

function parseBranches(
  source: string,
  filePath: string,
  symbols: readonly ExplainSymbol[],
): ExplainBranch[] {
  return source
    .split(/\r?\n/)
    .flatMap((line, index) => parseBranchLine(line, index + 1, filePath, symbols))
    .sort((left, right) => left.line - right.line || left.functionName.localeCompare(right.functionName));
}

function parseBranchLine(
  line: string,
  lineNumber: number,
  filePath: string,
  symbols: readonly ExplainSymbol[],
): ExplainBranch[] {
  const trimmed = line.trim();
  const functionName = findFunctionName(symbols, lineNumber) ?? filePath;
  const luaElseIf = /^elseif\s+(.+?)\s+then\b/.exec(trimmed);
  const luaIf = /^if\s+(.+?)\s+then\b/.exec(trimmed);
  const jsElseIf = /^}\s*else\s+if\s*\((.+)\)/.exec(trimmed) ?? /^else\s+if\s*\((.+)\)/.exec(trimmed);
  const jsIf = /^if\s*\((.+)\)/.exec(trimmed);
  const jsSwitch = /^switch\s*\((.+)\)/.exec(trimmed);
  const jsCase = /^case\s+(.+):/.exec(trimmed);
  const conditional = parseConditionalExpression(trimmed);

  if (luaElseIf?.[1] !== undefined) {
    return [createBranch(functionName, lineNumber, "elseif", luaElseIf[1])];
  }

  if (luaIf?.[1] !== undefined) {
    return [createBranch(functionName, lineNumber, "if", luaIf[1])];
  }

  if (jsElseIf?.[1] !== undefined) {
    return [createBranch(functionName, lineNumber, "elseif", jsElseIf[1])];
  }

  if (jsIf?.[1] !== undefined) {
    return [createBranch(functionName, lineNumber, "if", jsIf[1])];
  }

  if (jsSwitch?.[1] !== undefined) {
    return [createBranch(functionName, lineNumber, "switch", jsSwitch[1])];
  }

  if (jsCase?.[1] !== undefined) {
    return [createBranch(functionName, lineNumber, "case", jsCase[1])];
  }

  if (conditional !== undefined) {
    return [createBranch(functionName, lineNumber, "conditional", conditional)];
  }

  return [];
}

function parseConditionalExpression(trimmed: string): string | undefined {
  const questionIndex = trimmed.indexOf("?");
  const colonIndex = trimmed.indexOf(":", questionIndex + 1);

  if (questionIndex <= 0 || colonIndex <= questionIndex) {
    return undefined;
  }

  return trimmed.slice(0, questionIndex).replace(/^return\s+/, "").trim();
}

function createBranch(
  functionName: string,
  line: number,
  kind: ExplainBranch["kind"],
  condition: string,
): ExplainBranch {
  return {
    functionName,
    line,
    kind,
    condition: condition.trim(),
  };
}

async function queryDependencies(
  connection: Connection,
  filePath: string,
): Promise<ExplainDependency[]> {
  const rows = await queryRows(
    connection,
    `MATCH (source:File)-[require:Requires]->(target:File)
WHERE source.path = $filePath
RETURN source.path AS source, target.path AS target,
  require.moduleName AS moduleName, require.isResolved AS isResolved;`,
    { filePath },
  );

  return rows
    .map((row) => ({
      moduleName: readString(row.moduleName, "moduleName"),
      source: readString(row.source, "source"),
      target: readString(row.target, "target"),
      isResolved: readBoolean(row.isResolved, "isResolved"),
    }))
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.target.localeCompare(right.target) ||
        left.moduleName.localeCompare(right.moduleName),
    );
}

function createDataFlow(
  input: string,
  filePath: string,
  source: string,
  entrypoints: readonly ExplainEntrypoint[],
  flow: readonly ExplainFlow[],
  target: ResolvedTarget,
): ExplainDataFlowStep[] {
  const entrypoint = chooseDataFlowEntrypoint(entrypoints, flow, target);
  const steps: ExplainDataFlowStep[] = [
    {
      order: 1,
      label: `input:${input}`,
      source: "input",
      filePath,
    },
  ];

  if (entrypoint !== undefined) {
    steps.push({
      order: steps.length + 1,
      label: `入口 ${entrypoint.qualifiedName}`,
      source: "entrypoint",
      filePath: entrypoint.filePath,
      line: entrypoint.startLine,
    });
  }

  for (const call of firstCallPath(flow.find((item) => item.entrypoint === entrypoint?.qualifiedName)?.calls ?? [])) {
    steps.push({
      order: steps.length + 1,
      label: `调用 ${call.to}`,
      source: "callee",
      filePath: call.filePath,
      line: call.line,
    });
  }

  const returnLine = findReturnLine(source, entrypoint?.startLine);
  steps.push({
    order: steps.length + 1,
    label: "return result",
    source: "return",
    filePath,
    ...(returnLine === undefined ? {} : { line: returnLine }),
  });

  return steps;
}

function chooseDataFlowEntrypoint(
  entrypoints: readonly ExplainEntrypoint[],
  flow: readonly ExplainFlow[],
  target: ResolvedTarget,
): ExplainEntrypoint | undefined {
  if (target.type === "symbol") {
    return entrypoints.find((item) => item.qualifiedName === target.symbol.qualifiedName);
  }

  const flowWithCalls = flow.find((item) => item.calls.length > 0);

  return entrypoints.find((item) => item.qualifiedName === flowWithCalls?.entrypoint) ?? entrypoints[0];
}

function firstCallPath(calls: readonly ExplainFlowCall[]): ExplainFlowCall[] {
  const first = calls[0];

  if (first === undefined) {
    return [];
  }

  return [first, ...firstCallPath(first.calls)];
}

function createExternalGaps(
  filePath: string,
  dependencies: readonly ExplainDependency[],
  flow: readonly ExplainFlow[],
): string[] {
  const gaps = new Set<string>();

  for (const dependency of dependencies) {
    if (!dependency.isResolved) {
      gaps.add(`未解析 require/import: ${dependency.moduleName}`);
    } else if (dependency.target !== filePath) {
      gaps.add(`外部依赖需查看: ${dependency.moduleName} -> ${dependency.target}`);
    }
  }

  for (const call of flattenCalls(flow)) {
    if (call.filePath !== filePath) {
      gaps.add(`外部函数需查看: ${call.to} -> ${call.filePath}`);
    }
  }

  return [...gaps].sort((left, right) => left.localeCompare(right));
}

function flattenCalls(flow: readonly ExplainFlow[]): ExplainFlowCall[] {
  return flow.flatMap((item) => flattenCallNodes(item.calls));
}

function flattenCallNodes(calls: readonly ExplainFlowCall[]): ExplainFlowCall[] {
  return calls.flatMap((call) => [call, ...flattenCallNodes(call.calls)]);
}

async function querySymbolsInFile(
  connection: Connection,
  filePath: string,
): Promise<ExplainSymbol[]> {
  const rows = await queryRows(
    connection,
    `MATCH (symbol:Symbol)
WHERE symbol.filePath = $filePath
RETURN symbol.id AS id, symbol.kind AS kind, symbol.name AS name,
  symbol.qualifiedName AS qualifiedName, symbol.filePath AS filePath,
  symbol.startLine AS startLine, symbol.endLine AS endLine,
  symbol.signature AS signature, symbol.isLocal AS isLocal,
  symbol.isExported AS isExported;`,
    { filePath },
  );

  return sortSymbols(rows.map(toSymbol));
}

async function querySymbolsByName(
  connection: Connection,
  name: string,
): Promise<ExplainSymbol[]> {
  const rows = await queryRows(
    connection,
    `MATCH (symbol:Symbol)
WHERE symbol.name = $name OR symbol.qualifiedName = $name
RETURN symbol.id AS id, symbol.kind AS kind, symbol.name AS name,
  symbol.qualifiedName AS qualifiedName, symbol.filePath AS filePath,
  symbol.startLine AS startLine, symbol.endLine AS endLine,
  symbol.signature AS signature, symbol.isLocal AS isLocal,
  symbol.isExported AS isExported;`,
    { name },
  );

  return sortSymbols(rows.map(toSymbol));
}

async function queryExternalCallCount(
  connection: Connection,
  symbol: ExplainSymbol,
): Promise<number> {
  const rows = await queryRows(
    connection,
    `MATCH (caller:Symbol)-[:Calls]->(target:Symbol)
WHERE target.id = $targetId AND caller.filePath <> $filePath
RETURN caller.id AS id;`,
    { targetId: symbol.id, filePath: symbol.filePath },
  );

  return new Set(rows.map((row) => readString(row.id, "id"))).size;
}

async function queryCallees(
  connection: Connection,
  sourceId: string,
): Promise<ExplainCallRow[]> {
  const rows = await queryRows(
    connection,
    `MATCH (source:Symbol)-[call:Calls]->(target:Symbol)
WHERE source.id = $sourceId
RETURN target.id AS id, target.kind AS kind, target.name AS name,
  target.qualifiedName AS qualifiedName, target.filePath AS filePath,
  target.startLine AS startLine, target.endLine AS endLine,
  target.signature AS signature, target.isLocal AS isLocal,
  target.isExported AS isExported, call.line AS line,
  call.\`column\` AS callColumn, call.isResolved AS isResolved;`,
    { sourceId },
  );

  return rows
    .map((row) => ({
      symbol: toSymbol(row),
      line: readNumber(row.line, "line"),
      column: readNumber(row.callColumn, "callColumn"),
      isResolved: readBoolean(row.isResolved, "isResolved"),
    }))
    .sort(
      (left, right) =>
        left.line - right.line ||
        left.column - right.column ||
        left.symbol.qualifiedName.localeCompare(right.symbol.qualifiedName),
    );
}

function toSymbol(row: Record<string, unknown>): ExplainSymbol {
  return {
    id: readString(row.id, "id"),
    kind: readString(row.kind, "kind"),
    name: readString(row.name, "name"),
    qualifiedName: readString(row.qualifiedName, "qualifiedName"),
    filePath: readString(row.filePath, "filePath"),
    startLine: readNumber(row.startLine, "startLine"),
    endLine: readNumber(row.endLine, "endLine"),
    signature: readString(row.signature, "signature"),
    isLocal: readBoolean(row.isLocal, "isLocal"),
    isExported: readBoolean(row.isExported, "isExported"),
  };
}

function findFunctionName(symbols: readonly ExplainSymbol[], line: number): string | undefined {
  return symbols
    .filter((symbol) => symbol.startLine <= line && line <= symbol.endLine)
    .filter((symbol) => symbol.kind === "function" || symbol.kind === "method")
    .sort((left, right) => right.startLine - left.startLine)[0]?.qualifiedName;
}

function findReturnLine(source: string, startLine: number | undefined): number | undefined {
  const lines = source.split(/\r?\n/);
  const offset = startLine === undefined ? 0 : Math.max(startLine - 1, 0);
  const index = lines.findIndex((line, lineIndex) => lineIndex >= offset && /^\s*return\b/.test(line));

  return index < 0 ? undefined : index + 1;
}

function normalizeDepth(depth: number): number {
  if (!Number.isInteger(depth) || depth < 1) {
    throw new Error("explain --depth 必须是正整数");
  }

  return depth;
}

function normalizeInputPathQuery(projectRoot: string, input: string): string {
  const pathQuery = nodePath.isAbsolute(input) ? nodePath.relative(projectRoot, input) : input;

  return normalizeRepositoryPath(pathQuery).toLowerCase();
}

function isPathQueryMatched(filePath: string, query: string): boolean {
  const normalizedPath = filePath.toLowerCase();

  return normalizedPath.includes(query) || query.endsWith(`/${normalizedPath}`);
}

function looksLikeFilePath(input: string): boolean {
  return isSupportedFilePath(input) || input.includes("/") || input.includes("\\");
}

function isSupportedFilePath(input: string): boolean {
  return (
    input.endsWith(".lua") ||
    input.endsWith(".js") ||
    input.endsWith(".jsx") ||
    input.endsWith(".ts") ||
    input.endsWith(".tsx")
  );
}

function uniqueSymbols(symbols: readonly ExplainSymbol[]): ExplainSymbol[] {
  return sortSymbols([...new Map(symbols.map((symbol) => [symbol.id, symbol])).values()]);
}

function sortSymbols(symbols: readonly ExplainSymbol[]): ExplainSymbol[] {
  return [...symbols].sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.startLine - right.startLine ||
      left.qualifiedName.localeCompare(right.qualifiedName),
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
      throw new Error("explain 查询未返回结果");
    }

    return (await queryResult.getAll()) as Record<string, unknown>[];
  } finally {
    closeQueryResult(result);
  }
}

function readString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`explain 查询返回了无效字段：${name}`);
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

  throw new Error(`explain 查询返回了无效字段：${name}`);
}

function readBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`explain 查询返回了无效字段：${name}`);
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
