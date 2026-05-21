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

type EntrypointScore = {
  readonly externalCallCount: number;
  readonly callOutCount: number;
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
    const branches = parseBranches(source, filePath, symbols);
    const entrypoints = await createEntrypoints(connection, symbols, resolvedTarget);
    const topMethodEntrypoints = await createTopMethodEntrypoints(connection, symbols, resolvedTarget);
    const flow = await createFlow(connection, entrypoints, depth);
    const dependencies = await queryDependencies(connection, filePath);
    const dataFlow = createDataFlow(filePath, source, symbols, topMethodEntrypoints, flow, branches, resolvedTarget);
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
    .filter((symbol) => isExplicitEntrypoint(symbol, counts.get(symbol.id) ?? 0));
  const constructors = findClassConstructors(symbols);
  const selected = uniqueSymbols(
    target.type === "symbol"
      ? [...getTargetEntrypointSymbols(target.symbol), ...findTargetConstructors(constructors, target.symbol), ...candidates]
      : [...constructors, ...candidates],
  ).slice(0, 21);

  return selected.map((symbol) => ({
    ...toEntrypoint(symbol, counts.get(symbol.id) ?? 0),
  }));
}

async function createTopMethodEntrypoints(
  connection: Connection,
  symbols: readonly ExplainSymbol[],
  target: ResolvedTarget,
): Promise<ExplainEntrypoint[]> {
  if (target.type === "symbol") {
    const symbol = getTargetEntrypointSymbols(target.symbol)[0];
    return symbol === undefined ? [] : [toEntrypoint(symbol, await queryExternalCallCount(connection, symbol))];
  }

  const externalCallCounts = new Map<string, number>();
  const callOutCounts = new Map<string, number>();
  const candidates = symbols.filter((symbol) => symbol.kind === "function" || symbol.kind === "method");

  for (const symbol of candidates) {
    externalCallCounts.set(symbol.id, await queryExternalCallCount(connection, symbol));
    callOutCounts.set(symbol.id, await queryCallOutCount(connection, symbol));
  }

  return sortEntrypointsByValue(candidates, externalCallCounts, callOutCounts)
    .slice(0, 21)
    .map((symbol) => toEntrypoint(symbol, externalCallCounts.get(symbol.id) ?? 0));
}

function toEntrypoint(symbol: ExplainSymbol, externalCallCount: number): ExplainEntrypoint {
  return {
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    kind: symbol.kind,
    filePath: symbol.filePath,
    startLine: symbol.startLine,
    isExported: symbol.isExported,
    externalCallCount,
  };
}

function sortEntrypointsByValue(
  symbols: readonly ExplainSymbol[],
  externalCallCounts: ReadonlyMap<string, number>,
  callOutCounts: ReadonlyMap<string, number>,
): ExplainSymbol[] {
  return [...symbols].sort((left, right) => {
    const rightScore = scoreEntrypoint(right, externalCallCounts, callOutCounts);
    const leftScore = scoreEntrypoint(left, externalCallCounts, callOutCounts);

    return (
      sumEntrypointScore(rightScore) - sumEntrypointScore(leftScore) ||
      rightScore.externalCallCount - leftScore.externalCallCount ||
      rightScore.callOutCount - leftScore.callOutCount ||
      left.startLine - right.startLine ||
      left.qualifiedName.localeCompare(right.qualifiedName)
    );
  });
}

function scoreEntrypoint(
  symbol: ExplainSymbol,
  externalCallCounts: ReadonlyMap<string, number>,
  callOutCounts: ReadonlyMap<string, number>,
): EntrypointScore {
  return {
    externalCallCount: externalCallCounts.get(symbol.id) ?? 0,
    callOutCount: callOutCounts.get(symbol.id) ?? 0,
  };
}

function sumEntrypointScore(score: EntrypointScore): number {
  return score.externalCallCount * 3 + score.callOutCount;
}

function isExplicitEntrypoint(symbol: ExplainSymbol, externalCallCount: number): boolean {
  return (
    externalCallCount > 0 ||
    (symbol.isExported && symbol.kind === "function") ||
    isJavaScriptLowInboundEntrypoint(symbol, externalCallCount)
  );
}

function isJavaScriptLowInboundEntrypoint(symbol: ExplainSymbol, externalCallCount: number): boolean {
  return isJavaScriptLikeFilePath(symbol.filePath) && externalCallCount <= 1;
}

function isJavaScriptLikeFilePath(filePath: string): boolean {
  const extension = nodePath.posix.extname(filePath);

  return extension === ".js" || extension === ".jsx" || extension === ".ts" || extension === ".tsx";
}

function getTargetEntrypointSymbols(symbol: ExplainSymbol): readonly ExplainSymbol[] {
  return symbol.kind === "function" || symbol.kind === "method" ? [symbol] : [];
}

function findClassConstructors(symbols: readonly ExplainSymbol[]): ExplainSymbol[] {
  const classNames = new Set(
    symbols
      .filter((symbol) => symbol.kind === "class" || symbol.kind === "table")
      .map((symbol) => symbol.qualifiedName),
  );

  return symbols.filter(
    (symbol) =>
      symbol.kind === "method" &&
      symbol.name === "ctor" &&
      classNames.has(readMethodOwner(symbol.qualifiedName)),
  );
}

function findTargetConstructors(
  constructors: readonly ExplainSymbol[],
  target: ExplainSymbol,
): readonly ExplainSymbol[] {
  if (target.kind !== "class" && target.kind !== "table") {
    return [];
  }

  return constructors.filter((symbol) => readMethodOwner(symbol.qualifiedName) === target.qualifiedName);
}

function readMethodOwner(qualifiedName: string): string {
  const separatorIndex = Math.max(qualifiedName.lastIndexOf(":"), qualifiedName.lastIndexOf("."));

  return separatorIndex <= 0 ? "" : qualifiedName.slice(0, separatorIndex);
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
  filePath: string,
  source: string,
  symbols: readonly ExplainSymbol[],
  entrypoints: readonly ExplainEntrypoint[],
  flow: readonly ExplainFlow[],
  branches: readonly ExplainBranch[],
  target: ResolvedTarget,
): ExplainDataFlowStep[] {
  if (target.type === "file") {
    return entrypoints.slice(0, 21).map((entrypoint, index) => ({
      order: index + 1,
      label: entrypoint.qualifiedName,
      source: "top-method",
      filePath: entrypoint.filePath,
      line: entrypoint.startLine,
    }));
  }

  const steps: ExplainDataFlowStep[] = [
    {
      order: 1,
      label: `input ${formatInputParams(target.symbol, source)}`,
      source: "input",
      filePath,
    },
  ];
  const selectedEntrypoints = entrypoints.slice(0, 1);

  for (const entrypoint of selectedEntrypoints) {
    const symbol = findEntrypointSymbol(symbols, entrypoint);
    if (symbol === undefined) {
      continue;
    }

    steps.push({
      order: steps.length + 1,
      label: entrypoint.qualifiedName,
      source: "entrypoint",
      filePath: entrypoint.filePath,
      line: entrypoint.startLine,
    });

    const entrypointFlow = flow.find((item) => item.entrypoint === entrypoint.qualifiedName);
    const methodSteps = extractMethodDataFlowSteps(
      symbol,
      source,
      branches,
      entrypointFlow?.calls ?? [],
      16,
    );

    for (const step of methodSteps) {
      steps.push({ ...step, order: steps.length + 1 });
    }
  }

  if (steps.length === 1) {
    steps.push({
      order: steps.length + 1,
      label: "result",
      source: "return",
      filePath,
    });
  }

  return steps;
}

function extractMethodDataFlowSteps(
  symbol: ExplainSymbol,
  source: string,
  branches: readonly ExplainBranch[],
  calls: readonly ExplainFlowCall[],
  limit: number,
): ExplainDataFlowStep[] {
  const functionLines = readFunctionLines(source, symbol);
  const callLines = new Map(flattenCallNodes(calls).map((call) => [call.line, call]));
  const steps: ExplainDataFlowStep[] = [];

  for (const branch of branches.filter((item) => item.functionName === symbol.qualifiedName)) {
    steps.push({
      order: 0,
      label: branch.condition,
      source: "branch",
      filePath: symbol.filePath,
      line: branch.line,
    });
  }

  for (const { line, text } of functionLines) {
    const trimmed = text.trim();
    const assignment = parseAssignmentLine(trimmed);
    const call = callLines.get(line);

    if (assignment !== undefined) {
      steps.push({
        order: 0,
        label: assignment,
        source: isStateWrite(assignment) ? "state" : "assignment",
        filePath: symbol.filePath,
        line,
      });
      continue;
    }

    const sideEffectCall = parseSideEffectCall(trimmed);
    if (sideEffectCall !== undefined) {
      steps.push({
        order: 0,
        label: sideEffectCall,
        source: "call",
        filePath: symbol.filePath,
        line,
      });
      continue;
    }

    if (/^return\b/.test(trimmed)) {
      steps.push({
        order: 0,
        label: trimCodeSummary(trimmed.replace(/^return\b\s*/, "")) || "result",
        source: "return",
        filePath: symbol.filePath,
        line,
      });
      continue;
    }

    if (call !== undefined) {
      steps.push({
        order: 0,
        label: call.to,
        source: "callee",
        filePath: call.filePath,
        line: call.line,
      });
    }
  }

  if (!steps.some((step) => step.source === "return")) {
    steps.push({
      order: 0,
      label: "side effects",
      source: "return",
      filePath: symbol.filePath,
      line: symbol.endLine,
    });
  }

  const uniqueSteps = uniqueDataFlowSteps(steps)
    .sort((left, right) => (left.line ?? 0) - (right.line ?? 0) || sourcePriority(left.source) - sourcePriority(right.source))
    .slice(0, limit);
  const returnStep = steps.find((step) => step.source === "return");

  if (returnStep !== undefined && !uniqueSteps.some((step) => step.source === "return")) {
    return [...uniqueSteps.slice(0, Math.max(limit - 1, 0)), returnStep];
  }

  return uniqueSteps;
}

function findEntrypointSymbol(
  symbols: readonly ExplainSymbol[],
  entrypoint: ExplainEntrypoint,
): ExplainSymbol | undefined {
  return symbols.find(
    (symbol) =>
      symbol.qualifiedName === entrypoint.qualifiedName &&
      symbol.filePath === entrypoint.filePath &&
      symbol.startLine === entrypoint.startLine,
  );
}

function formatInputParams(symbol: ExplainSymbol, source: string): string {
  const params = parseFunctionParams(symbol, source);

  return params.length === 0 ? symbol.qualifiedName : params.join(", ");
}

function parseFunctionParams(symbol: ExplainSymbol, source: string): string[] {
  const header = readFunctionLines(source, symbol)
    .slice(0, 8)
    .map((line) => line.text)
    .join(" ");
  const match = /\(([^)]*)\)/.exec(header);

  if (match?.[1] === undefined) {
    return [];
  }

  return match[1]
    .split(",")
    .map((param) => param.trim().replace(/[?:].*$/, "").replace(/=.*/, "").trim())
    .filter((param) => param.length > 0);
}

function readFunctionLines(source: string, symbol: ExplainSymbol): { readonly line: number; readonly text: string }[] {
  return source
    .split(/\r?\n/)
    .slice(symbol.startLine - 1, symbol.endLine)
    .map((text, index) => ({ line: symbol.startLine + index, text }));
}

function parseAssignmentLine(trimmed: string): string | undefined {
  if (isControlLine(trimmed) || trimmed.includes("=>")) {
    return undefined;
  }

  if (/^[\w$.]+[:.][\w$]+\s*\(/.test(trimmed)) {
    return undefined;
  }

  const assignment = /^(?:const|let|var|local)?\s*([\w$.[\]'"]+)(?:\s*:\s*[^=({]+)?\s*=\s*(.+)$/.exec(trimmed);

  if (assignment?.[1] === undefined || assignment[2] === undefined) {
    return undefined;
  }

  return `${assignment[1]} = ${trimCodeSummary(assignment[2])}`;
}

function parseSideEffectCall(trimmed: string): string | undefined {
  if (isControlLine(trimmed) || /^return\b/.test(trimmed) || !trimmed.includes("(")) {
    return undefined;
  }

  const call = /^([\w$.:]+(?:\.[\w$]+)?)\s*\((.*)\)/.exec(trimmed);
  if (call?.[1] === undefined) {
    return undefined;
  }

  return trimCodeSummary(trimmed);
}

function isControlLine(trimmed: string): boolean {
  return /^(if|elseif|else if|for|while|switch|case|function|async function|end\b|\})/.test(trimmed);
}

function isStateWrite(assignment: string): boolean {
  return /^(self|this)\./.test(assignment) || /^\w+(ById|ByKey|Map|Set)\b/.test(assignment);
}

function trimCodeSummary(value: string): string {
  return value.replace(/[;,]\s*$/, "").trim().slice(0, 140);
}

function uniqueDataFlowSteps(steps: readonly ExplainDataFlowStep[]): ExplainDataFlowStep[] {
  return [...new Map(steps.map((step) => [`${step.source}:${step.line}:${step.label}`, step])).values()];
}

function sourcePriority(source: ExplainDataFlowStep["source"]): number {
  const order: Record<ExplainDataFlowStep["source"], number> = {
    input: 0,
    entrypoint: 1,
    "top-method": 1,
    branch: 2,
    assignment: 3,
    state: 4,
    call: 5,
    callee: 6,
    return: 7,
  };

  return order[source];
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

async function queryCallOutCount(
  connection: Connection,
  symbol: ExplainSymbol,
): Promise<number> {
  const rows = await queryRows(
    connection,
    `MATCH (source:Symbol)-[:Calls]->(target:Symbol)
WHERE source.id = $sourceId
RETURN target.id AS id;`,
    { sourceId: symbol.id },
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
  return [...new Map(symbols.map((symbol) => [symbol.id, symbol])).values()];
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
