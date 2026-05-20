import { normalizeRepositoryPath } from "./path.js";
import type { LuaCall, LuaFile, LuaSymbol, NormalizedPath, SymbolKind } from "./types.js";

type SymbolDraft = {
  readonly kind: SymbolKind;
  readonly name: string;
  readonly qualifiedName: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly signature: string;
  readonly isLocal: boolean;
};

type FunctionScope = {
  readonly draft: SymbolDraft;
  readonly closeDepth: number;
};

const classPattern =
  /^(?<indent>\s*)(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*class\s*\(\s*["'](?<literal>[A-Za-z_][A-Za-z0-9_]*)["']/;
const tablePattern = /^(?<indent>\s*)(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:\{|$)/;
const functionPattern =
  /^(?<indent>\s*)(?<local>local\s+)?function\s+(?<qualifiedName>[A-Za-z_][A-Za-z0-9_]*(?:[.:][A-Za-z_][A-Za-z0-9_]*)*)\s*\(/;
const callPattern = /(?<![A-Za-z0-9_])(?<callee>[A-Za-z_][A-Za-z0-9_]*(?:[.:][A-Za-z_][A-Za-z0-9_]*)*)\s*\(/g;

// Phase 1 最小提取：行级模式只识别声明入口，不伪装完整 Lua AST。
export function parseLuaFile(pathValue: string, source: string): LuaFile {
  const filePath = normalizeRepositoryPath(pathValue);
  const symbols = extractLuaSymbols(filePath, source);
  const calls = extractLuaCalls(filePath, source);

  return {
    type: "File",
    path: filePath,
    symbols,
    calls,
  };
}

export function extractLuaSymbols(filePath: NormalizedPath, source: string): readonly LuaSymbol[] {
  const lines = source.split(/\r\n|\n|\r/);
  const drafts = extractSymbolDrafts(lines);

  return drafts.map((draft) => createSymbol(filePath, draft));
}

export function extractLuaCalls(filePath: NormalizedPath, source: string): readonly LuaCall[] {
  return source
    .split(/\r\n|\n|\r/)
    .flatMap((line, index) => parseCallLine(filePath, stripLuaLine(line), index + 1));
}

function extractSymbolDrafts(lines: readonly string[]): readonly SymbolDraft[] {
  const drafts: SymbolDraft[] = [];
  const functionScopes: FunctionScope[] = [];
  let blockDepth = 0;

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const lineDrafts = parseLine(line, lineNumber);

    for (const draft of lineDrafts) {
      if (isFunctionDraft(draft)) {
        functionScopes.push({ draft, closeDepth: blockDepth });
      } else {
        drafts.push(draft);
      }
    }

    blockDepth = Math.max(0, blockDepth + getLuaBlockDelta(line));
    closeResolvedFunctions(functionScopes, drafts, blockDepth, lineNumber, line.length);
  }

  closeOpenFunctionsAtFileEnd(functionScopes, drafts, lines);

  return drafts.sort((left, right) => left.startLine - right.startLine || left.startColumn - right.startColumn);
}

function parseLine(line: string, lineNumber: number): readonly SymbolDraft[] {
  const classSymbol = parseClassLine(line, lineNumber);

  if (classSymbol !== undefined) {
    return [classSymbol];
  }

  const tableSymbol = parseTableLine(line, lineNumber);
  if (tableSymbol !== undefined) {
    return [tableSymbol];
  }

  const functionSymbol = parseFunctionLine(line, lineNumber);

  return functionSymbol === undefined ? [] : [functionSymbol];
}

function parseCallLine(
  filePath: NormalizedPath,
  strippedLine: string,
  lineNumber: number,
): readonly LuaCall[] {
  const calls: LuaCall[] = [];

  for (const match of strippedLine.matchAll(callPattern)) {
    const callee = match.groups?.callee;
    const callIndex = match.index;
    if (callee === undefined || callIndex === undefined || isDeclarationCallMatch(strippedLine, callIndex)) {
      continue;
    }

    calls.push({
      type: "Call",
      filePath,
      calleeQualifiedName: callee,
      line: lineNumber,
      column: callIndex + 1,
    });
  }

  return calls;
}

function isDeclarationCallMatch(line: string, callIndex: number): boolean {
  return /\bfunction\s+$/.test(line.slice(0, callIndex));
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
    endLine: lineNumber,
    startColumn: getDeclarationColumn(match.groups.indent),
    endColumn: line.length,
    signature: line.trim(),
    isLocal: false,
  };
}

function parseTableLine(line: string, lineNumber: number): SymbolDraft | undefined {
  const match = tablePattern.exec(line);

  if (match?.groups === undefined) {
    return undefined;
  }

  if ((match.groups.indent ?? "").length > 0) {
    return undefined;
  }

  const name = match.groups.name;
  if (name === undefined) {
    return undefined;
  }

  return {
    kind: "table",
    name,
    qualifiedName: name,
    startLine: lineNumber,
    endLine: lineNumber,
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
    endLine: lineNumber,
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
    endLine: draft.endLine,
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
  return /[.:]/.test(qualifiedName) ? "method" : "function";
}

function getSymbolName(qualifiedName: string): string {
  const segments = qualifiedName.split(/[.:]/);
  return segments[segments.length - 1] ?? qualifiedName;
}

function isFunctionDraft(draft: SymbolDraft): boolean {
  return draft.kind === "function" || draft.kind === "method";
}

function closeResolvedFunctions(
  functionScopes: FunctionScope[],
  drafts: SymbolDraft[],
  blockDepth: number,
  lineNumber: number,
  endColumn: number,
): void {
  while (functionScopes.length > 0) {
    const current = functionScopes[functionScopes.length - 1];

    if (current === undefined || blockDepth > current.closeDepth) {
      return;
    }

    functionScopes.pop();
    drafts.push(closeFunctionDraft(current.draft, lineNumber, endColumn));
  }
}

function closeOpenFunctionsAtFileEnd(
  functionScopes: FunctionScope[],
  drafts: SymbolDraft[],
  lines: readonly string[],
): void {
  const endLine = Math.max(1, lines.length);
  const endColumn = lines[endLine - 1]?.length ?? 0;

  while (functionScopes.length > 0) {
    const current = functionScopes.pop();

    if (current !== undefined) {
      drafts.push(closeFunctionDraft(current.draft, endLine, endColumn));
    }
  }
}

function closeFunctionDraft(draft: SymbolDraft, endLine: number, endColumn: number): SymbolDraft {
  return {
    ...draft,
    endLine,
    endColumn,
  };
}

function getLuaBlockDelta(line: string): number {
  const tokens = getLuaTokens(line);
  let openCount = 0;
  let closeCount = 0;

  for (const [index, token] of tokens.entries()) {
    const previousToken = tokens[index - 1];

    if (token === "function" || token === "repeat" || token === "do") {
      openCount += 1;
    }

    if (token === "then" && previousToken !== "elseif") {
      openCount += 1;
    }

    if (token === "end" || token === "until") {
      closeCount += 1;
    }
  }

  return openCount - closeCount;
}

function getLuaTokens(line: string): readonly string[] {
  return stripLuaLine(line).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
}

function stripLuaLine(line: string): string {
  let stripped = "";
  let quote: string | undefined;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (quote !== undefined) {
      stripped += " ";

      if (char === "\\") {
        index += 1;
        stripped += " ";
      } else if (char === quote) {
        quote = undefined;
      }

      continue;
    }

    if (char === "-" && nextChar === "-") {
      break;
    }

    if (char === '"' || char === "'") {
      quote = char;
      stripped += " ";
      continue;
    }

    stripped += char;
  }

  return stripped;
}
