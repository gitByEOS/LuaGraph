import nodePath from "node:path";

import Parser from "tree-sitter";
import Lua from "tree-sitter-lua";

import type { ParsedCall, ParsedExtend, ParsedFile, ParsedRequire, ParsedSymbol, NormalizedPath, SymbolKind } from "../types.js";

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

type LuaContext = {
  readonly filePath: NormalizedPath;
  readonly source: string;
  readonly lines: readonly string[];
  readonly rootNode: Parser.SyntaxNode;
};

const luaParser = new Parser();
luaParser.setLanguage(Lua);

export function parseLuaFile(pathValue: string, source: string): ParsedFile {
  const filePath = normalizeRepositoryPath(pathValue);
  const context = createLuaContext(filePath, source);

  return {
    type: "File",
    path: filePath,
    symbols: extractLuaSymbolsFromTree(context),
    calls: extractLuaCallsFromTree(context),
    extends: extractLuaExtendsFromTree(context),
    requires: extractLuaRequiresFromTree(context),
  };
}

export function extractLuaSymbols(filePath: NormalizedPath, source: string): readonly ParsedSymbol[] {
  return extractLuaSymbolsFromTree(createLuaContext(filePath, source));
}

export function extractLuaCalls(filePath: NormalizedPath, source: string): readonly ParsedCall[] {
  return extractLuaCallsFromTree(createLuaContext(filePath, source));
}

export function extractLuaExtends(filePath: NormalizedPath, source: string): readonly ParsedExtend[] {
  return extractLuaExtendsFromTree(createLuaContext(filePath, source));
}

export function extractLuaRequires(filePath: NormalizedPath, source: string): readonly ParsedRequire[] {
  return extractLuaRequiresFromTree(createLuaContext(filePath, source));
}

function createLuaContext(filePath: NormalizedPath, source: string): LuaContext {
  return {
    filePath,
    source,
    lines: source.split(/\r\n|\n|\r/),
    rootNode: luaParser.parse(source).rootNode,
  };
}

function extractLuaSymbolsFromTree(context: LuaContext): readonly ParsedSymbol[] {
  const drafts = [
    ...context.rootNode.descendantsOfType(["variable_assignment", "local_variable_declaration"]).flatMap((node) =>
      parseAssignmentSymbol(context, node),
    ),
    ...context.rootNode.descendantsOfType(["function_definition_statement", "local_function_definition_statement"]).flatMap((node) =>
      parseFunctionSymbol(context, node),
    ),
  ];

  return drafts
    .sort((left, right) => left.startLine - right.startLine || left.startColumn - right.startColumn)
    .map((draft) => createSymbol(context.filePath, draft));
}

function extractLuaCallsFromTree(context: LuaContext): readonly ParsedCall[] {
  return context.rootNode
    .descendantsOfType("call")
    .flatMap((node) => parseCall(context.filePath, node));
}

function extractLuaExtendsFromTree(context: LuaContext): readonly ParsedExtend[] {
  return context.rootNode
    .descendantsOfType(["variable_assignment", "local_variable_declaration"])
    .flatMap((node) => parseExtends(context.filePath, node));
}

function extractLuaRequiresFromTree(context: LuaContext): readonly ParsedRequire[] {
  return context.rootNode
    .descendantsOfType("call")
    .flatMap((node) => parseRequire(context.filePath, node));
}

function parseAssignmentSymbol(context: LuaContext, node: Parser.SyntaxNode): readonly SymbolDraft[] {
  const assignment = readAssignment(node);

  if (assignment === undefined) {
    return [];
  }

  if (isCallNamed(assignment.value, "class") || getSetmetatableParent(assignment.value) !== undefined) {
    return [createAssignmentSymbol(context, node, assignment, "class")];
  }

  if (isRootTableAssignment(node, assignment)) {
    return [createAssignmentSymbol(context, node, assignment, "table")];
  }

  return [];
}

function parseFunctionSymbol(context: LuaContext, node: Parser.SyntaxNode): readonly SymbolDraft[] {
  const nameNode = node.namedChildren.find((child) => child.type === "variable" || child.type === "identifier");

  if (nameNode === undefined) {
    return [];
  }

  const qualifiedName = nameNode.text;
  return [
    {
      kind: getFunctionKind(qualifiedName),
      name: getSymbolName(qualifiedName),
      qualifiedName,
      startLine: toLine(node),
      endLine: node.endPosition.row + 1,
      startColumn: toColumn(node),
      endColumn: node.endPosition.column,
      signature: getSignature(context.lines, node),
      isLocal: node.type === "local_function_definition_statement",
    },
  ];
}

function createAssignmentSymbol(
  context: LuaContext,
  node: Parser.SyntaxNode,
  assignment: AssignmentNode,
  kind: Extract<SymbolKind, "class" | "table">,
): SymbolDraft {
  return {
    kind,
    name: assignment.name,
    qualifiedName: assignment.name,
    startLine: toLine(node),
    endLine: node.endPosition.row + 1,
    startColumn: toColumn(node),
    endColumn: node.endPosition.column,
    signature: getSignature(context.lines, node),
    isLocal: node.type === "local_variable_declaration",
  };
}

function parseCall(filePath: NormalizedPath, node: Parser.SyntaxNode): readonly ParsedCall[] {
  const calleeQualifiedName = getCallCalleeName(node);

  if (calleeQualifiedName === undefined) {
    return [];
  }

  return [
    {
      type: "Call",
      filePath,
      calleeQualifiedName,
      line: toLine(node),
      column: toColumn(node),
    },
  ];
}

function parseExtends(filePath: NormalizedPath, node: Parser.SyntaxNode): readonly ParsedExtend[] {
  const assignment = readAssignment(node);

  if (assignment === undefined) {
    return [];
  }

  const parentQualifiedName = getClassParent(assignment.value) ?? getSetmetatableParent(assignment.value);

  if (parentQualifiedName === undefined || assignment.name === parentQualifiedName) {
    return [];
  }

  return [
    {
      type: "Extends",
      filePath,
      childQualifiedName: assignment.name,
      parentQualifiedName,
      line: toLine(node),
      column: toColumn(node),
    },
  ];
}

function parseRequire(filePath: NormalizedPath, node: Parser.SyntaxNode): readonly ParsedRequire[] {
  if (!isCallNamed(node, "require")) {
    return [];
  }

  const argument = getFirstCallArgument(node);

  if (argument === undefined) {
    return [];
  }

  const moduleName = parseStaticRequireModule(argument) ?? normalizeRequireExpression(argument.text);

  return [
    {
      type: "Require",
      filePath,
      moduleName,
      isStatic: argument.type === "string",
      line: toLine(node),
      column: toColumn(node),
    },
  ];
}

function createSymbol(filePath: NormalizedPath, draft: SymbolDraft): ParsedSymbol {
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

type AssignmentNode = {
  readonly name: string;
  readonly variable: Parser.SyntaxNode;
  readonly value: Parser.SyntaxNode;
};

function readAssignment(node: Parser.SyntaxNode): AssignmentNode | undefined {
  const variable = firstNamedChildOfType(node, "variable_list")?.namedChildren[0];
  const value = firstNamedChildOfType(node, "expression_list")?.namedChildren[0];

  if (variable?.type !== "variable" || value === undefined) {
    return undefined;
  }

  return {
    name: variable.text,
    variable,
    value,
  };
}

function firstNamedChildOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | undefined {
  return node.namedChildren.find((child) => child.type === type);
}

function isRootTableAssignment(node: Parser.SyntaxNode, assignment: AssignmentNode): boolean {
  return node.type === "variable_assignment" && node.parent?.type === "chunk" && assignment.variable.startPosition.column === 0 && assignment.value.type === "table";
}

function isCallNamed(node: Parser.SyntaxNode, name: string): boolean {
  return getCallCalleeName(node) === name;
}

function getCallCalleeName(node: Parser.SyntaxNode): string | undefined {
  const callee = node.namedChildren[0];

  return callee?.type === "variable" ? callee.text : undefined;
}

function getFirstCallArgument(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  const argumentList = firstNamedChildOfType(node, "argument_list");
  const argument = argumentList?.namedChildren[0];

  return argument?.type === "expression_list" ? argument.namedChildren[0] : argument;
}

function getCallArguments(node: Parser.SyntaxNode): readonly Parser.SyntaxNode[] {
  const argumentList = firstNamedChildOfType(node, "argument_list");
  const argument = argumentList?.namedChildren[0];

  return argument?.type === "expression_list" ? argument.namedChildren : argumentList?.namedChildren ?? [];
}

function getClassParent(node: Parser.SyntaxNode): string | undefined {
  if (!isCallNamed(node, "class")) {
    return undefined;
  }

  const parent = getCallArguments(node)[1];

  return parent?.type === "variable" ? parent.text : undefined;
}

function getSetmetatableParent(node: Parser.SyntaxNode): string | undefined {
  if (!isCallNamed(node, "setmetatable")) {
    return undefined;
  }

  const metatable = getCallArguments(node)[1];
  const indexField = metatable?.descendantsOfType("field").find(isIndexField);
  const parent = indexField?.namedChildren[1];

  return parent?.type === "variable" ? parent.text : undefined;
}

function isIndexField(node: Parser.SyntaxNode): boolean {
  return node.namedChildren[0]?.text === "__index";
}

function parseStaticRequireModule(node: Parser.SyntaxNode): string | undefined {
  if (node.type !== "string") {
    return undefined;
  }

  return unwrapLuaString(node.text);
}

function unwrapLuaString(value: string): string {
  const quote = value[0];

  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1);
  }

  const longString = /^\[(=*)\[([\s\S]*)\]\1\]$/.exec(value);

  return longString?.[2] ?? value;
}

function normalizeRequireExpression(expression: string): string {
  return expression.trim().replace(/\s+/g, " ");
}

function getSignature(lines: readonly string[], node: Parser.SyntaxNode): string {
  return lines[node.startPosition.row]?.trim() ?? node.text.trim();
}

function toLine(node: Parser.SyntaxNode): number {
  return node.startPosition.row + 1;
}

function toColumn(node: Parser.SyntaxNode): number {
  return node.startPosition.column + 1;
}

function getFunctionKind(qualifiedName: string): SymbolKind {
  return /[.:]/.test(qualifiedName) ? "method" : "function";
}

function getSymbolName(qualifiedName: string): string {
  const segments = qualifiedName.split(/[.:]/);
  return segments[segments.length - 1] ?? qualifiedName;
}

function normalizeRepositoryPath(value: string): NormalizedPath {
  const normalized = value.replaceAll("\\", "/").replaceAll(/\/+/g, "/").replace(/^\.\//, "");

  if (nodePath.posix.isAbsolute(normalized)) {
    throw new Error("路径必须是仓库相对路径");
  }

  if (normalized.split("/").includes("..")) {
    throw new Error("路径不能包含 ..");
  }

  return normalized as NormalizedPath;
}
