import nodePath from "node:path";

import {
  type ClassDeclaration,
  type FunctionDeclaration,
  type MethodDeclaration,
  Node,
  Project,
  ScriptKind,
  type SourceFile,
  SyntaxKind,
  ts,
  type VariableDeclaration,
} from "ts-morph";

import type { NormalizedPath, ParsedCall, ParsedExtend, ParsedFile, ParsedRequire, ParsedSymbol, SymbolKind } from "../types.js";

type SymbolDraft = {
  readonly kind: SymbolKind;
  readonly name: string;
  readonly qualifiedName: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly signature: string;
  readonly isLocal: boolean;
  readonly isExported: boolean;
};

type JsContext = {
  readonly filePath: NormalizedPath;
  readonly sourceFile: SourceFile;
  readonly exportedNames: ReadonlySet<string>;
};

const project = new Project({
  useInMemoryFileSystem: true,
  compilerOptions: {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
  },
});

export function parseJsFile(pathValue: string, source: string): ParsedFile {
  const filePath = normalizeRepositoryPath(pathValue);
  const context = createJsContext(filePath, source);

  return {
    type: "File",
    path: filePath,
    symbols: extractJsSymbolsFromTree(context),
    calls: extractJsCallsFromTree(context),
    extends: extractJsExtendsFromTree(context),
    requires: extractJsRequiresFromTree(context),
  };
}

export function extractJsSymbols(filePath: NormalizedPath, source: string): readonly ParsedSymbol[] {
  return extractJsSymbolsFromTree(createJsContext(filePath, source));
}

export function extractJsCalls(filePath: NormalizedPath, source: string): readonly ParsedCall[] {
  return extractJsCallsFromTree(createJsContext(filePath, source));
}

export function extractJsExtends(filePath: NormalizedPath, source: string): readonly ParsedExtend[] {
  return extractJsExtendsFromTree(createJsContext(filePath, source));
}

export function extractJsRequires(filePath: NormalizedPath, source: string): readonly ParsedRequire[] {
  return extractJsRequiresFromTree(createJsContext(filePath, source));
}

function createJsContext(filePath: NormalizedPath, source: string): JsContext {
  const sourceFile = project.createSourceFile(
    `/${filePath}`,
    source,
    {
      overwrite: true,
      scriptKind: getScriptKind(filePath),
    },
  );

  return {
    filePath,
    sourceFile,
    exportedNames: readExportedNames(sourceFile),
  };
}

function extractJsSymbolsFromTree(context: JsContext): readonly ParsedSymbol[] {
  return context.sourceFile
    .getDescendants()
    .flatMap((node) => parseSymbol(context, node))
    .sort((left, right) => left.startLine - right.startLine || left.startColumn - right.startColumn)
    .map((draft) => createSymbol(context.filePath, draft));
}

function extractJsCallsFromTree(context: JsContext): readonly ParsedCall[] {
  const calls = context.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).map((node) => ({
    type: "Call" as const,
    filePath: context.filePath,
    calleeQualifiedName: normalizeExpressionName(node.getExpression().getText()),
    line: toLine(node),
    column: toColumn(node),
  }));
  const newCalls = context.sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression).map((node) => ({
    type: "Call" as const,
    filePath: context.filePath,
    calleeQualifiedName: normalizeExpressionName(node.getExpression().getText()),
    line: toLine(node),
    column: toColumn(node),
  }));

  return [...calls, ...newCalls].filter((call) => call.calleeQualifiedName.length > 0);
}

function extractJsExtendsFromTree(context: JsContext): readonly ParsedExtend[] {
  return context.sourceFile
    .getDescendantsOfKind(SyntaxKind.ClassDeclaration)
    .flatMap((node) => parseExtends(context.filePath, node));
}

function extractJsRequiresFromTree(context: JsContext): readonly ParsedRequire[] {
  const imports = context.sourceFile.getImportDeclarations().flatMap((node) => {
    if (node.isTypeOnly()) {
      return [];
    }

    return [
      {
        type: "Require" as const,
        filePath: context.filePath,
        moduleName: node.getModuleSpecifierValue(),
        isStatic: true,
        line: toLine(node),
        column: toColumn(node),
      },
    ];
  });
  const exports = context.sourceFile.getExportDeclarations().flatMap((node) => {
    if (node.isTypeOnly() || node.getModuleSpecifierValue() === undefined) {
      return [];
    }

    return [
      {
        type: "Require" as const,
        filePath: context.filePath,
        moduleName: node.getModuleSpecifierValue() ?? "",
        isStatic: true,
        line: toLine(node),
        column: toColumn(node),
      },
    ];
  });
  const calls = context.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).flatMap((node) => {
    const callee = normalizeExpressionName(node.getExpression().getText());

    if (callee !== "require" && callee !== "import") {
      return [];
    }

    const argument = node.getArguments()[0];
    if (argument === undefined) {
      return [];
    }

    return [
      {
        type: "Require" as const,
        filePath: context.filePath,
        moduleName: readStaticString(argument) ?? normalizeRequireExpression(argument.getText()),
        isStatic: readStaticString(argument) !== undefined,
        line: toLine(node),
        column: toColumn(node),
      },
    ];
  });

  return [...imports, ...exports, ...calls];
}

function parseSymbol(context: JsContext, node: Node): readonly SymbolDraft[] {
  if (Node.isClassDeclaration(node)) {
    return parseClassSymbol(context, node);
  }

  if (Node.isMethodDeclaration(node)) {
    return parseMethodSymbol(context, node);
  }

  if (Node.isFunctionDeclaration(node)) {
    return parseFunctionSymbol(context, node);
  }

  if (Node.isVariableDeclaration(node)) {
    return parseVariableFunctionSymbol(context, node);
  }

  return [];
}

function parseClassSymbol(context: JsContext, node: ClassDeclaration): readonly SymbolDraft[] {
  const name = node.getName() ?? "default";
  const isExported = isNodeExported(context, node, name);

  return [
    {
      kind: "class",
      name,
      qualifiedName: name,
      ...getNodeRange(node),
      signature: getSignature(node),
      isLocal: !isExported,
      isExported,
    },
  ];
}

function parseMethodSymbol(context: JsContext, node: MethodDeclaration): readonly SymbolDraft[] {
  const parentClass = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);

  if (parentClass === undefined) {
    return [];
  }

  const className = parentClass.getName() ?? "default";
  const methodName = node.getName();
  const qualifiedName = `${className}.${methodName}`;
  const isExported = isNodeExported(context, parentClass, className);

  return [
    {
      kind: "method",
      name: methodName,
      qualifiedName,
      ...getNodeRange(node),
      signature: getSignature(node),
      isLocal: !isExported,
      isExported,
    },
  ];
}

function parseFunctionSymbol(context: JsContext, node: FunctionDeclaration): readonly SymbolDraft[] {
  const name = node.getName() ?? "default";
  const isExported = isNodeExported(context, node, name);

  return [
    {
      kind: "function",
      name,
      qualifiedName: name,
      ...getNodeRange(node),
      signature: getSignature(node),
      isLocal: !isExported,
      isExported,
    },
  ];
}

function parseVariableFunctionSymbol(context: JsContext, node: VariableDeclaration): readonly SymbolDraft[] {
  const initializer = node.getInitializer();

  if (initializer === undefined || (!Node.isFunctionExpression(initializer) && !Node.isArrowFunction(initializer))) {
    return [];
  }

  const name = node.getName();
  const statement = node.getFirstAncestorByKind(SyntaxKind.VariableStatement) ?? node;
  const isExported = isNodeExported(context, statement, name);

  return [
    {
      kind: "function",
      name,
      qualifiedName: name,
      ...getNodeRange(statement),
      signature: getSignature(statement),
      isLocal: !isExported,
      isExported,
    },
  ];
}

function parseExtends(filePath: NormalizedPath, node: ClassDeclaration): readonly ParsedExtend[] {
  const childQualifiedName = node.getName();
  const parent = node.getExtends();

  if (childQualifiedName === undefined || parent === undefined) {
    return [];
  }

  return [
    {
      type: "Extends",
      filePath,
      childQualifiedName,
      parentQualifiedName: normalizeExpressionName(parent.getExpression().getText()),
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
    isExported: draft.isExported,
    isUnresolved: false,
  };
}

function readExportedNames(sourceFile: SourceFile): ReadonlySet<string> {
  return new Set([...sourceFile.getExportedDeclarations()].flatMap(([name, declarations]) => (
    name === "default" ? declarations.map((declaration) => declaration.getSymbol()?.getName() ?? "default") : [name]
  )));
}

function isNodeExported(context: JsContext, node: Node, name: string): boolean {
  return hasModifier(node, SyntaxKind.ExportKeyword) || context.exportedNames.has(name);
}

type ModifierOwner = {
  readonly getModifiers: () => readonly Node[];
};

function hasModifier(node: Node, kind: SyntaxKind): boolean {
  if (!hasModifiers(node)) {
    return false;
  }

  return node.getModifiers().some((modifier) => modifier.getKind() === kind);
}

function hasModifiers(node: Node): node is Node & ModifierOwner {
  return typeof (node as Partial<ModifierOwner>).getModifiers === "function";
}

function readStaticString(node: Node): string | undefined {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }

  return undefined;
}

function normalizeExpressionName(expression: string): string {
  return expression.trim().replace(/^this\./, "").replace(/\s+/g, " ");
}

function normalizeRequireExpression(expression: string): string {
  return expression.trim().replace(/\s+/g, " ");
}

function getNodeRange(node: Node): Pick<SymbolDraft, "startLine" | "startColumn" | "endLine" | "endColumn"> {
  const start = node.getSourceFile().getLineAndColumnAtPos(node.getStart());
  const end = node.getSourceFile().getLineAndColumnAtPos(node.getEnd());

  return {
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

function getSignature(node: Node): string {
  return node.getText().split(/\r\n|\n|\r/)[0]?.trim() ?? node.getText().trim();
}

function toLine(node: Node): number {
  return node.getSourceFile().getLineAndColumnAtPos(node.getStart()).line;
}

function toColumn(node: Node): number {
  return node.getSourceFile().getLineAndColumnAtPos(node.getStart()).column;
}

function getScriptKind(filePath: NormalizedPath): ScriptKind {
  const extension = nodePath.posix.extname(filePath);

  if (extension === ".jsx") {
    return ScriptKind.JSX;
  }

  if (extension === ".ts") {
    return ScriptKind.TS;
  }

  if (extension === ".tsx") {
    return ScriptKind.TSX;
  }

  return ScriptKind.JS;
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
