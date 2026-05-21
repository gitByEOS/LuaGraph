import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { Connection, Database, type QueryResult } from "kuzu";

import type { SchemaStatement } from "./project-types.js";

export const schemaStatements: readonly SchemaStatement[] = [
  {
    name: "File",
    cypher:
      "CREATE NODE TABLE IF NOT EXISTS File(path STRING PRIMARY KEY, contentHash STRING, size UINT64, modifiedAt TIMESTAMP, indexedAt TIMESTAMP, nodeCount UINT64, error STRING);",
  },
  {
    name: "Symbol",
    cypher:
      "CREATE NODE TABLE IF NOT EXISTS Symbol(id STRING PRIMARY KEY, kind STRING, name STRING, qualifiedName STRING, filePath STRING, startLine UINT64, endLine UINT64, startColumn UINT64, endColumn UINT64, docstring STRING, signature STRING, isLocal BOOLEAN, isExported BOOLEAN, isUnresolved BOOLEAN, updatedAt TIMESTAMP);",
  },
  {
    name: "Contains",
    cypher: "CREATE REL TABLE IF NOT EXISTS Contains(FROM File TO Symbol, FROM Symbol TO Symbol);",
  },
  {
    name: "Calls",
    cypher:
      "CREATE REL TABLE IF NOT EXISTS Calls(FROM Symbol TO Symbol, line UINT64, `column` UINT64, isResolved BOOLEAN);",
  },
  {
    name: "Requires",
    cypher:
      "CREATE REL TABLE IF NOT EXISTS Requires(FROM File TO File, FROM Symbol TO Symbol, moduleName STRING, isResolved BOOLEAN);",
  },
  {
    name: "Returns",
    cypher: "CREATE REL TABLE IF NOT EXISTS Returns(FROM Symbol TO Symbol);",
  },
  {
    name: "Assigns",
    cypher: "CREATE REL TABLE IF NOT EXISTS Assigns(FROM Symbol TO Symbol);",
  },
  {
    name: "Extends",
    cypher: "CREATE REL TABLE IF NOT EXISTS Extends(FROM Symbol TO Symbol);",
  },
];

export async function initializeStore(databaseDir: string): Promise<void> {
  await mkdir(databaseDir, { recursive: true });

  const database = new Database(getKuzuDatabasePath(databaseDir));
  const connection = new Connection(database);

  try {
    for (const statement of schemaStatements) {
      closeQueryResult(await connection.query(statement.cypher));
    }
  } finally {
    await connection.close();
    await database.close();
  }
}

export function getKuzuDatabasePath(databaseDir: string): string {
  return join(databaseDir, "database");
}

function closeQueryResult(result: QueryResult | QueryResult[]): void {
  const results = Array.isArray(result) ? result : [result];

  for (const item of results) {
    item.close();
  }
}
