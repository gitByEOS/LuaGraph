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

export type SymbolKind = "class" | "table" | "module" | "method" | "function";

export type LuaFile = {
  readonly type: "File";
  readonly path: NormalizedPath;
  readonly symbols: readonly LuaSymbol[];
  readonly calls: readonly LuaCall[];
  readonly extends: readonly LuaExtend[];
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

export type LuaCall = {
  readonly type: "Call";
  readonly filePath: NormalizedPath;
  readonly calleeQualifiedName: string;
  readonly line: number;
  readonly column: number;
};

export type LuaExtend = {
  readonly type: "Extends";
  readonly filePath: NormalizedPath;
  readonly childQualifiedName: string;
  readonly parentQualifiedName: string;
  readonly line: number;
  readonly column: number;
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
  readonly parseErrorCount: number;
  readonly symbolKindCounts: Record<string, number>;
  readonly pendingSyncChangeCount: number;
  readonly databaseDir: string;
  readonly configPath: string;
  readonly schemaCount: number;
};

export type SampleSymbol = {
  readonly kind: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly isLocal: boolean;
  readonly signature: string;
};

export type SampleResult = {
  readonly projectRoot: string;
  readonly count: number;
  readonly symbols: readonly SampleSymbol[];
};

export type IndexResult = {
  readonly fileCount: number;
  readonly symbolCount: number;
  readonly containsCount: number;
  readonly callsCount: number;
  readonly databaseDir: string;
};

export type SyncResult = {
  readonly scannedFileCount: number;
  readonly changedFileCount: number;
  readonly removedFileCount: number;
  readonly symbolCount: number;
  readonly containsCount: number;
  readonly databaseDir: string;
};

export type QueryNode = QueryFileNode | QuerySymbolNode;

export type QueryFileNode = {
  readonly type: "File";
  readonly id: string;
  readonly kind: "file";
  readonly name: string;
  readonly path: string;
};

export type QuerySymbolNode = {
  readonly type: "Symbol";
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly signature: string;
};

export type QueryCallEdge = {
  readonly kind: "Calls";
  readonly source: string;
  readonly target: string;
  readonly line: number;
  readonly column: number;
  readonly isResolved: boolean;
};

export type QueryExtendsEdge = {
  readonly kind: "Extends";
  readonly source: string;
  readonly target: string;
};

export type QueryEdge = QueryCallEdge | QueryExtendsEdge;

export type LuaGraphQueryResult = {
  readonly projectRoot: string;
  readonly expression: string;
  readonly count: number;
  readonly nodes: readonly QueryNode[];
  readonly edges: readonly QueryEdge[];
};

export type ImpactSeed = QuerySymbolNode;

export type LuaGraphImpactResult = {
  readonly projectRoot: string;
  readonly input: string;
  readonly depth: number;
  readonly seeds: readonly ImpactSeed[];
  readonly count: number;
  readonly nodes: readonly QuerySymbolNode[];
  readonly files: readonly string[];
  readonly edges: readonly QueryCallEdge[];
};
