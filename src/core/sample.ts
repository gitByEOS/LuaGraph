import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Connection, Database, type QueryResult } from "kuzu";

import { configPath, readConfig } from "./config.js";
import { getKuzuDatabasePath } from "./store.js";
import type { SampleResult, SampleSymbol } from "./project-types.js";

export type SampleProjectOptions = {
  readonly limit?: number;
};

export async function sampleProject(
  projectRoot: string,
  options: SampleProjectOptions = {},
): Promise<SampleResult> {
  const resolvedProjectRoot = resolve(projectRoot);
  const limit = normalizeLimit(options.limit ?? 20);
  const config = await readConfig(resolvedProjectRoot);

  if (config === undefined) {
    throw new Error(`项目尚未 init：缺少 ${join(resolvedProjectRoot, configPath)}`);
  }

  const databasePath = getKuzuDatabasePath(resolve(resolvedProjectRoot, config.databaseDir));
  await assertIndexedDatabase(databasePath);

  const symbols = await readSampleSymbols(databasePath, limit);
  if (symbols.length === 0) {
    throw new Error("项目尚未 index：Kuzu 中没有 Symbol 抽查数据");
  }

  return {
    projectRoot: resolvedProjectRoot,
    count: symbols.length,
    symbols,
  };
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("sample --limit 必须是正整数");
  }

  return limit;
}

async function assertIndexedDatabase(databasePath: string): Promise<void> {
  if (!(await pathExists(databasePath))) {
    throw new Error("项目尚未 index：缺少 Kuzu 数据库");
  }
}

async function readSampleSymbols(databasePath: string, limit: number): Promise<SampleSymbol[]> {
  const database = new Database(databasePath, undefined, undefined, true);
  const connection = new Connection(database);

  try {
    return await querySampleSymbols(connection, limit);
  } finally {
    await connection.close();
    await database.close();
  }
}

async function querySampleSymbols(connection: Connection, limit: number): Promise<SampleSymbol[]> {
  const rows = await queryRows(
    connection,
    `MATCH (symbol:Symbol)
RETURN symbol.kind AS kind, symbol.name AS name, symbol.qualifiedName AS qualifiedName,
  symbol.filePath AS filePath, symbol.startLine AS startLine, symbol.isLocal AS isLocal,
  symbol.signature AS signature
ORDER BY symbol.filePath, symbol.startLine, symbol.kind, symbol.name
LIMIT ${limit};`,
  );

  return rows.map(toSampleSymbol);
}

async function queryRows(connection: Connection, cypher: string): Promise<Record<string, unknown>[]> {
  let result: QueryResult | QueryResult[] | undefined;

  try {
    result = await connection.query(cypher);
    const queryResult = Array.isArray(result) ? result[0] : result;
    if (queryResult === undefined) {
      throw new Error("sample 查询未返回结果");
    }

    return (await queryResult.getAll()) as Record<string, unknown>[];
  } finally {
    closeQueryResult(result);
  }
}

function toSampleSymbol(row: Record<string, unknown>): SampleSymbol {
  return {
    kind: readString(row.kind, "kind"),
    name: readString(row.name, "name"),
    qualifiedName: readString(row.qualifiedName, "qualifiedName"),
    filePath: readString(row.filePath, "filePath"),
    startLine: readNumber(row.startLine, "startLine"),
    isLocal: readBoolean(row.isLocal, "isLocal"),
    signature: readString(row.signature, "signature"),
  };
}

function readString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`sample 查询返回了无效字段：${name}`);
  }

  return value;
}

function readNumber(value: unknown, name: string): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  throw new Error(`sample 查询返回了无效字段：${name}`);
}

function readBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`sample 查询返回了无效字段：${name}`);
  }

  return value;
}

function closeQueryResult(result: QueryResult | QueryResult[] | undefined): void {
  const results = Array.isArray(result) ? result : result === undefined ? [] : [result];

  for (const item of results) {
    item.close();
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

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
