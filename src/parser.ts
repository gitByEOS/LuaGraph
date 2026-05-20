import { normalizeRepositoryPath } from "./path.js";
import type { LuaFile, LuaSymbol, NormalizedPath, SymbolKind } from "./types.js";

type SymbolDraft = {
  readonly kind: SymbolKind;
  readonly name: string;
  readonly qualifiedName: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly signature: string;
  readonly isLocal: boolean;
};

const classPattern =
  /^(?<indent>\s*)(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*class\s*\(\s*["'](?<literal>[A-Za-z_][A-Za-z0-9_]*)["']/;
const functionPattern =
  /^(?<indent>\s*)(?<local>local\s+)?function\s+(?<qualifiedName>[A-Za-z_][A-Za-z0-9_]*(?:[.:][A-Za-z_][A-Za-z0-9_]*)*)\s*\(/;

// Phase 1 最小提取：行级模式只识别声明入口，不伪装完整 Lua AST。
export function parseLuaFile(pathValue: string, source: string): LuaFile {
  const filePath = normalizeRepositoryPath(pathValue);
  const symbols = extractLuaSymbols(filePath, source);

  return {
    type: "File",
    path: filePath,
    symbols,
  };
}

export function extractLuaSymbols(filePath: NormalizedPath, source: string): readonly LuaSymbol[] {
  const lines = source.split(/\r\n|\n|\r/);
  const drafts = lines.flatMap((line, index) => parseLine(line, index + 1));

  return drafts.map((draft) => createSymbol(filePath, draft));
}

function parseLine(line: string, lineNumber: number): readonly SymbolDraft[] {
  const classSymbol = parseClassLine(line, lineNumber);

  if (classSymbol !== undefined) {
    return [classSymbol];
  }

  const functionSymbol = parseFunctionLine(line, lineNumber);

  return functionSymbol === undefined ? [] : [functionSymbol];
}

function parseClassLine(line: string, lineNumber: number): SymbolDraft | undefined {
  const match = classPattern.exec(line);

  if (match?.groups === undefined) {
    return undefined;
  }

  const name = match.groups.name;

  if (name === undefined) {
    return undefined;
  }

  return {
    kind: "class",
    name,
    qualifiedName: name,
    startLine: lineNumber,
    startColumn: getDeclarationColumn(match.groups.indent),
    endColumn: line.length,
    signature: line.trim(),
    isLocal: false,
  };
}

function parseFunctionLine(line: string, lineNumber: number): SymbolDraft | undefined {
  const match = functionPattern.exec(line);

  if (match?.groups === undefined) {
    return undefined;
  }

  const qualifiedName = match.groups.qualifiedName;

  if (qualifiedName === undefined) {
    return undefined;
  }

  return {
    kind: getFunctionKind(qualifiedName),
    name: getSymbolName(qualifiedName),
    qualifiedName,
    startLine: lineNumber,
    startColumn: getDeclarationColumn(match.groups.indent),
    endColumn: line.length,
    signature: line.trim(),
    isLocal: match.groups.local !== undefined,
  };
}

function createSymbol(filePath: NormalizedPath, draft: SymbolDraft): LuaSymbol {
  return {
    type: "Symbol",
    id: `${filePath}#${draft.kind}#${draft.qualifiedName}#${draft.startLine}:${draft.startColumn}`,
    kind: draft.kind,
    name: draft.name,
    qualifiedName: draft.qualifiedName,
    filePath,
    startLine: draft.startLine,
    startColumn: draft.startColumn,
    endLine: draft.startLine,
    endColumn: draft.endColumn,
    signature: draft.signature,
    isLocal: draft.isLocal,
    isExported: !draft.isLocal,
    isUnresolved: false,
  };
}

function getDeclarationColumn(indent: string | undefined): number {
  return (indent?.length ?? 0) + 1;
}

function getFunctionKind(qualifiedName: string): SymbolKind {
  return qualifiedName.includes(":") ? "method" : "function";
}

function getSymbolName(qualifiedName: string): string {
  const segments = qualifiedName.split(/[.:]/);
  return segments[segments.length - 1] ?? qualifiedName;
}
