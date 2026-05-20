export type NormalizedPath = string & {
  readonly __normalizedPath: unique symbol;
};

export type LuaGraphConfig = {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly databaseDir: string;
};

export type ScannedLuaFile = {
  readonly path: NormalizedPath;
  readonly size: number;
  readonly modifiedAt: Date;
};

export type SchemaStatement = {
  readonly name: string;
  readonly cypher: string;
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
