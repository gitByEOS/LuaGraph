import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Connection, Database, type QueryResult } from "kuzu";

import { configPath, readConfig } from "./config.js";
import { getKuzuDatabasePath, schemaStatements } from "./store.js";
import type { StatusResult } from "./types.js";

export async function getProjectStatus(projectRoot: string): Promise<StatusResult> {
  const resolvedProjectRoot = resolve(projectRoot);

  await assertExistingDirectory(resolvedProjectRoot, projectRoot);

  const config = await readConfig(resolvedProjectRoot);
  if (config === undefined) {
    throw new Error(`项目缺少配置文件：${join(resolvedProjectRoot, configPath)}`);
  }

  const databaseDir = resolve(resolvedProjectRoot, config.databaseDir);
  const databasePath = getKuzuDatabasePath(databaseDir);
  const baseStatus = {
    databaseDir,
    configPath: join(resolvedProjectRoot, configPath),
    schemaCount: schemaStatements.length,
  };

  if (!(await pathExists(databasePath))) {
    return {
      ...baseStatus,
      fileCount: 0,
      symbolCount: 0,
      edgeCount: 0,
    };
  }

  const database = new Database(databasePath, undefined, undefined, true);
  const connection = new Connection(database);

  try {
    const fileCount = await countQuery(
      connection,
      "MATCH (file:File) RETURN count(file) AS count;",
    );
    const symbolCount = await countQuery(
      connection,
      "MATCH (symbol:Symbol) RETURN count(symbol) AS count;",
    );
    const edgeCount = await countQuery(
      connection,
      "MATCH ()-[edge]->() RETURN count(edge) AS count;",
    );

    return {
      ...baseStatus,
      fileCount,
      symbolCount,
      edgeCount,
    };
  } finally {
    await connection.close();
    await database.close();
  }
}

async function countQuery(connection: Connection, cypher: string): Promise<number> {
  let result: QueryResult | QueryResult[] | undefined;

  try {
    result = await connection.query(cypher);
    const queryResult = Array.isArray(result) ? result[0] : result;
    if (queryResult === undefined) {
      throw new Error("状态查询未返回结果");
    }

    const rows = await queryResult.getAll();
    return toCount(rows[0]?.count);
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return 0;
    }

    throw error;
  } finally {
    closeQueryResult(result);
  }
}

function toCount(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  throw new Error("状态查询返回了无效计数");
}

function closeQueryResult(result: QueryResult | QueryResult[] | undefined): void {
  if (result === undefined) {
    return;
  }

  const results = Array.isArray(result) ? result : [result];

  for (const item of results) {
    item.close();
  }
}

async function assertExistingDirectory(
  resolvedProjectRoot: string,
  inputProjectRoot: string,
): Promise<void> {
  let stats;

  try {
    stats = await stat(resolvedProjectRoot);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error(`项目路径不存在：${inputProjectRoot}`);
    }

    throw error;
  }

  if (!stats.isDirectory()) {
    throw new Error(`项目路径不是目录：${inputProjectRoot}`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingSchemaError(error: unknown): boolean {
  return error instanceof Error && /does not exist|not found|cannot find/i.test(error.message);
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
