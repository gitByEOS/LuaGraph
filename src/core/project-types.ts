import type { NormalizedPath } from "../ast/types.js";

export type LuaGraphConfig = {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly databaseDir: string;
};

export type SchemaStatement = {
  readonly name: string;
  readonly cypher: string;
};

export type ScannedProjectFile = {
  readonly path: NormalizedPath;
  readonly size: number;
  readonly modifiedAt: Date;
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
  readonly extendsCount: number;
  readonly requiresCount: number;
  readonly databaseDir: string;
};

export type SyncResult = {
  readonly scannedFileCount: number;
  readonly changedFileCount: number;
  readonly removedFileCount: number;
  readonly symbolCount: number;
  readonly containsCount: number;
  readonly extendsCount: number;
  readonly requiresCount: number;
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

export type QueryRequireEdge = {
  readonly kind: "Requires";
  readonly source: string;
  readonly target: string;
  readonly moduleName: string;
  readonly isResolved: boolean;
};

export type QueryEdge = QueryCallEdge | QueryExtendsEdge | QueryRequireEdge;

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
  readonly edges: readonly QueryEdge[];
};

export type ExplainTarget = {
  readonly type: "file" | "symbol";
  readonly name: string;
  readonly filePath: string;
  readonly startLine?: number;
};

export type ExplainEntrypoint = {
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly isExported: boolean;
  readonly externalCallCount: number;
};

export type ExplainFlowCall = {
  readonly from: string;
  readonly to: string;
  readonly filePath: string;
  readonly line: number;
  readonly isResolved: boolean;
  readonly calls: readonly ExplainFlowCall[];
};

export type ExplainFlow = {
  readonly entrypoint: string;
  readonly filePath: string;
  readonly calls: readonly ExplainFlowCall[];
};

export type ExplainBranch = {
  readonly functionName: string;
  readonly line: number;
  readonly kind: "if" | "elseif" | "switch" | "case" | "conditional";
  readonly condition: string;
};

export type ExplainDependency = {
  readonly moduleName: string;
  readonly source: string;
  readonly target: string;
  readonly isResolved: boolean;
};

export type ExplainDataFlowStep = {
  readonly order: number;
  readonly label: string;
  readonly source: "input" | "entrypoint" | "callee" | "return";
  readonly filePath: string;
  readonly line?: number;
};

export type LuaGraphExplainResult = {
  readonly projectRoot: string;
  readonly input: string;
  readonly depth: number;
  readonly target: ExplainTarget;
  readonly entrypoints: readonly ExplainEntrypoint[];
  readonly flow: readonly ExplainFlow[];
  readonly branches: readonly ExplainBranch[];
  readonly dependencies: readonly ExplainDependency[];
  readonly dataFlow: readonly ExplainDataFlowStep[];
  readonly externalGaps: readonly string[];
};
