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

export type InitPlan = {
  readonly projectRoot: string;
  readonly config: LuaGraphConfig;
  readonly schema: readonly SchemaStatement[];
};
