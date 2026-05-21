export type NormalizedPath = string & {
  readonly __normalizedPath: unique symbol;
};

export type SymbolKind = "class" | "table" | "module" | "method" | "function";

export type ParsedFile = {
  readonly type: "File";
  readonly path: NormalizedPath;
  readonly symbols: readonly ParsedSymbol[];
  readonly calls: readonly ParsedCall[];
  readonly extends: readonly ParsedExtend[];
  readonly requires: readonly ParsedRequire[];
};

export type ParsedSymbol = {
  readonly type: "Symbol";
  readonly id: string;
  readonly kind: SymbolKind;
  readonly name: string;
  readonly qualifiedName: string;
  readonly filePath: NormalizedPath;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly signature: string;
  readonly isLocal: boolean;
  readonly isExported: boolean;
  readonly isUnresolved: boolean;
};

export type ParsedCall = {
  readonly type: "Call";
  readonly filePath: NormalizedPath;
  readonly calleeQualifiedName: string;
  readonly line: number;
  readonly column: number;
};

export type ParsedExtend = {
  readonly type: "Extends";
  readonly filePath: NormalizedPath;
  readonly childQualifiedName: string;
  readonly parentQualifiedName: string;
  readonly line: number;
  readonly column: number;
};

export type ParsedRequire = {
  readonly type: "Require";
  readonly filePath: NormalizedPath;
  readonly moduleName: string;
  readonly isStatic: boolean;
  readonly line: number;
  readonly column: number;
};

export type LuaFile = ParsedFile;
export type LuaSymbol = ParsedSymbol;
export type LuaCall = ParsedCall;
export type LuaExtend = ParsedExtend;
export type LuaRequire = ParsedRequire;
