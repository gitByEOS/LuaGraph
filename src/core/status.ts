import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Connection, Database, type QueryResult } from "kuzu";

import { configPath, readConfig } from "./config.js";
import { scanProjectFiles } from "./scanner.js";
import { getKuzuDatabasePath, schemaStatements } from "./store.js";
import type { NormalizedPath } from "../ast/types.js";
import type { ScannedProjectFile, StatusResult } from "./project-types.js";

export async function getProjectStatus(projectRoot: string): Promise<StatusResult> {
  const resolvedProjectRoot = resolve(projectRoot);

  await assertExistingDirectory(resolvedProjectRoot, projectRoot);

  const config = await readConfig(resolvedProjectRoot);
  if (config === undefined) {
    throw new Error(`项目缺少配置文件：${join(resolvedProjectRoot, configPath)}`);
  }

  const databaseDir = resolve(resolvedProjectRoot, config.databaseDir);
  const databasePath = getKuzuDatabasePath(databaseDir);
  const files = await scanProjectFiles(resolvedProjectRoot, config);
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
      parseErrorCount: 0,
      symbolKindCounts: {},
      pendingSyncChangeCount: files.length,
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
    const parseErrorCount = await countQuery(
      connection,
      "MATCH (file:File) WHERE file.error <> '' RETURN count(file) AS count;",
    );
    const symbolKindCounts = await querySymbolKindCounts(connection);
    const indexedFileHashes = await queryIndexedFileHashes(connection);
    const pendingSyncChangeCount = await countPendingSyncChanges(
      resolvedProjectRoot,
      files,
      indexedFileHashes,
    );

    return {
      ...baseStatus,
      fileCount,
      symbolCount,
      edgeCount,
      parseErrorCount,
      symbolKindCounts,
      pendingSyncChangeCount,
    };
  } finally {
    await connection.close();
    await database.close();
  }
}

async function countQuery(connection: Connection, cypher: string): Promise<number> {
  const rows = await queryRows(connection, cypher);

  return toCount(rows[0]?.count ?? 0);
}

async function querySymbolKindCounts(connection: Connection): Promise<Record<string, number>> {
  const rows = await queryRows(
    connection,
    "MATCH (symbol:Symbol) RETURN symbol.kind AS kind, count(symbol) AS count;",
  );
  const entries: [string, number][] = rows.map((row) => [String(row.kind), toCount(row.count)]);

  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

async function queryIndexedFileHashes(connection: Connection): Promise<Map<NormalizedPath, string>> {
  const rows = await queryRows(
    connection,
    "MATCH (file:File) RETURN file.path AS path, file.contentHash AS contentHash;",
  );

  return new Map(
    rows.map((row) => [String(row.path) as NormalizedPath, String(row.contentHash)]),
  );
}

async function queryRows(connection: Connection, cypher: string): Promise<Record<string, unknown>[]> {
  let result: QueryResult | QueryResult[] | undefined;

  try {
    result = await connection.query(cypher);
    const queryResult = Array.isArray(result) ? result[0] : result;
    if (queryResult === undefined) {
      throw new Error("状态查询未返回结果");
    }

    return (await queryResult.getAll()) as Record<string, unknown>[];
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return [];
    }

    throw error;
  } finally {
    closeQueryResult(result);
  }
}

async function countPendingSyncChanges(
  projectRoot: string,
  files: readonly ScannedProjectFile[],
  indexedFileHashes: ReadonlyMap<NormalizedPath, string>,
): Promise<number> {
  const currentFileHashes = await createCurrentFileHashes(projectRoot, files);
  const addedOrModifiedCount = [...currentFileHashes].filter(
    ([path, contentHash]) => indexedFileHashes.get(path) !== contentHash,
  ).length;
  const deletedCount = [...indexedFileHashes.keys()].filter(
    (path) => !currentFileHashes.has(path),
  ).length;

  return addedOrModifiedCount + deletedCount;
}

async function createCurrentFileHashes(
  projectRoot: string,
  files: readonly ScannedProjectFile[],
): Promise<Map<NormalizedPath, string>> {
  const entries = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(join(projectRoot, file.path), "utf8");

      return [file.path, createContentHash(content)] as const;
    }),
  );

  return new Map(entries);
}

function createContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
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
