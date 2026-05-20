export type NormalizedPath = string & {
  readonly __normalizedPath: unique symbol;
};

export type LuaGraphConfig = {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly databaseDir: string;
};

export type SchemaStatement = {
  readonly name: string;
  readonly cypher: string;
};

export type ScannedLuaFile = {
  readonly path: NormalizedPath;
  readonly size: number;
  readonly modifiedAt: Date;
};

export type SymbolKind = "table" | "module" | "method" | "function";

export type LuaFile = {
  readonly type: "File";
  readonly path: NormalizedPath;
  readonly symbols: readonly LuaSymbol[];
};

export type LuaSymbol = {
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

export type InitPlan = {
  readonly projectRoot: string;
  readonly config: LuaGraphConfig;
  readonly schema: readonly SchemaStatement[];
};

export type InitResult = {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly databaseDir: string;
  readonly schemaCount: number;
};

export type StatusResult = {
  readonly fileCount: number;
  readonly symbolCount: number;
  readonly edgeCount: number;
  readonly databaseDir: string;
  readonly configPath: string;
  readonly schemaCount: number;
};
