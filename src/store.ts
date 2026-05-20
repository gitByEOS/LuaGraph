import type { SchemaStatement } from "./types.js";

export const schemaStatements: readonly SchemaStatement[] = [
  {
    name: "File",
    cypher:
      "CREATE NODE TABLE IF NOT EXISTS File(path STRING, contentHash STRING, indexedAt TIMESTAMP, PRIMARY KEY(path));",
  },
  {
    name: "Symbol",
    cypher:
      "CREATE NODE TABLE IF NOT EXISTS Symbol(id STRING, path STRING, kind STRING, name STRING, qualifiedName STRING, startLine INT64, startColumn INT64, PRIMARY KEY(id));",
  },
  {
    name: "Contains",
    cypher: "CREATE REL TABLE IF NOT EXISTS Contains(FROM File TO Symbol, FROM Symbol TO Symbol);",
  },
];
