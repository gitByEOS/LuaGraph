import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import nodePath from "node:path";

import { Connection, Database, type QueryResult } from "kuzu";

import { deleteCallsForFiles, rebuildCallsRelationships } from "./call-graph.js";
import { configPath, readConfig } from "./config.js";
import { parseLuaFile } from "./parser.js";
import { scanLuaFiles } from "./scanner.js";
import { getKuzuDatabasePath, schemaStatements } from "./store.js";
import type { LuaSymbol, NormalizedPath, ScannedLuaFile, SyncResult } from "./types.js";

type HashedLuaFile = {
  readonly file: ScannedLuaFile;
  readonly content: string;
  readonly contentHash: string;
};

export async function syncProject(projectRoot: string): Promise<SyncResult> {
  const resolvedProjectRoot = nodePath.resolve(projectRoot);

  await assertExistingDirectory(resolvedProjectRoot, projectRoot);

  const config = await readConfig(resolvedProjectRoot);
  if (config === undefined) {
    throw new Error(`项目缺少配置文件：${nodePath.join(resolvedProjectRoot, configPath)}`);
  }

  const files = await scanLuaFiles(resolvedProjectRoot, config);
  const currentFiles = await hashLuaFiles(resolvedProjectRoot, files);
  const databaseDir = nodePath.resolve(resolvedProjectRoot, config.databaseDir);
  const databasePath = getKuzuDatabasePath(databaseDir);

  await mkdir(databaseDir, { recursive: true });

  const database = new Database(databasePath);
  const connection = new Connection(database);

  try {
    await initializeSchema(connection);

    const indexedFileHashes = await queryIndexedFileHashes(connection);
    const changedFiles = currentFiles.filter(
      (file) => indexedFileHashes.get(file.file.path) !== file.contentHash,
    );
    const removedFilePaths = [...indexedFileHashes.keys()].filter(
      (path) => !currentFiles.some((file) => file.file.path === path),
    );

    const affectedFilePaths = [
      ...removedFilePaths,
      ...changedFiles.map((file) => file.file.path),
    ];

    await deleteCallsForFiles(connection, affectedFilePaths);
    await removeIndexedFiles(connection, affectedFilePaths);
    await writeChangedFiles(connection, changedFiles);
    if (affectedFilePaths.length > 0) {
      await rebuildCallsRelationships(
        connection,
        currentFiles.map((file) => parseLuaFile(file.file.path, file.content)),
      );
    }

    return {
      scannedFileCount: files.length,
      changedFileCount: changedFiles.length,
      removedFileCount: removedFilePaths.length,
      symbolCount: await countQuery(connection, "MATCH (symbol:Symbol) RETURN count(symbol) AS count;"),
      containsCount: await countQuery(
        connection,
        "MATCH (:File)-[contains:Contains]->(:Symbol) RETURN count(contains) AS count;",
      ),
      databaseDir,
    };
  } finally {
    await connection.close();
    await database.close();
  }
}

async function hashLuaFiles(
  projectRoot: string,
  files: readonly ScannedLuaFile[],
): Promise<HashedLuaFile[]> {
  return Promise.all(
    files.map(async (file) => {
      const content = await readFile(nodePath.join(projectRoot, file.path), "utf8");

      return {
        file,
        content,
        contentHash: createContentHash(content),
      };
    }),
  );
}

function createContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function initializeSchema(connection: Connection): Promise<void> {
  for (const statement of schemaStatements) {
    closeResult(await connection.query(statement.cypher));
  }
}

async function queryIndexedFileHashes(
  connection: Connection,
): Promise<Map<NormalizedPath, string>> {
  const rows = await queryRows(
    connection,
    "MATCH (file:File) RETURN file.path AS path, file.contentHash AS contentHash;",
  );

  return new Map(rows.map((row) => [String(row.path) as NormalizedPath, String(row.contentHash)]));
}

async function removeIndexedFiles(
  connection: Connection,
  filePaths: readonly NormalizedPath[],
): Promise<void> {
  const containsStatement = await connection.prepare(
    "MATCH (file:File {path: $path})-[contains:Contains]->(symbol:Symbol) DELETE contains;",
  );
  const symbolStatement = await connection.prepare(
    "MATCH (symbol:Symbol) WHERE symbol.filePath = $path DELETE symbol;",
  );
  const fileStatement = await connection.prepare("MATCH (file:File {path: $path}) DELETE file;");

  for (const path of filePaths) {
    closeResult(await connection.execute(containsStatement, { path }));
    closeResult(await connection.execute(symbolStatement, { path }));
    closeResult(await connection.execute(fileStatement, { path }));
  }
}

async function writeChangedFiles(
  connection: Connection,
  files: readonly HashedLuaFile[],
): Promise<void> {
  for (const file of files) {
    const parsed = parseLuaFile(file.file.path, file.content);

    await insertFile(connection, file, parsed.symbols.length);

    for (const symbol of parsed.symbols) {
      await insertSymbol(connection, symbol);
    }

    await insertContainsRelationships(connection, file.file.path, parsed.symbols);
  }
}

async function insertFile(
  connection: Connection,
  file: HashedLuaFile,
  nodeCount: number,
): Promise<void> {
  const now = new Date();
  const statement = await connection.prepare(
    "MERGE (n:File {path: $path}) SET n.contentHash = $contentHash, n.size = $size, n.modifiedAt = $modifiedAt, n.indexedAt = $indexedAt, n.nodeCount = $nodeCount, n.error = $error",
  );

  closeResult(
    await connection.execute(statement, {
      path: file.file.path,
      contentHash: file.contentHash,
      size: BigInt(file.file.size),
      modifiedAt: file.file.modifiedAt,
      indexedAt: now,
      nodeCount: BigInt(nodeCount),
      error: "",
    }),
  );
}

async function insertSymbol(connection: Connection, symbol: LuaSymbol): Promise<void> {
  const now = new Date();
  const statement = await connection.prepare(
    "MERGE (n:Symbol {id: $id}) SET n.kind = $kind, n.name = $name, n.qualifiedName = $qualifiedName, n.filePath = $filePath, n.startLine = $startLine, n.endLine = $endLine, n.startColumn = $startColumn, n.endColumn = $endColumn, n.docstring = $docstring, n.signature = $signature, n.isLocal = $isLocal, n.isExported = $isExported, n.isUnresolved = $isUnresolved, n.updatedAt = $updatedAt",
  );

  closeResult(
    await connection.execute(statement, {
      id: symbol.id,
      kind: symbol.kind,
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      filePath: symbol.filePath,
      startLine: BigInt(symbol.startLine),
      endLine: BigInt(symbol.endLine),
      startColumn: BigInt(symbol.startColumn),
      endColumn: BigInt(symbol.endColumn),
      docstring: "",
      signature: symbol.signature,
      isLocal: symbol.isLocal,
      isExported: symbol.isExported,
      isUnresolved: symbol.isUnresolved,
      updatedAt: now,
    }),
  );
}

async function insertContainsRelationships(
  connection: Connection,
  filePath: NormalizedPath,
  symbols: readonly LuaSymbol[],
): Promise<void> {
  const statement = await connection.prepare(
    "MATCH (f:File {path: $fromPath}), (s:Symbol {id: $toId}) CREATE (f)-[r:Contains]->(s)",
  );

  for (const symbol of symbols) {
    closeResult(await connection.execute(statement, { fromPath: filePath, toId: symbol.id }));
  }
}

async function countQuery(connection: Connection, cypher: string): Promise<number> {
  const rows = await queryRows(connection, cypher);

  return toCount(rows[0]?.count ?? 0);
}

async function queryRows(connection: Connection, cypher: string): Promise<Record<string, unknown>[]> {
  let result: QueryResult | QueryResult[] | undefined;

  try {
    result = await connection.query(cypher);
    const queryResult = Array.isArray(result) ? result[0] : result;
    if (queryResult === undefined) {
      throw new Error("同步查询未返回结果");
    }

    return (await queryResult.getAll()) as Record<string, unknown>[];
  } finally {
    closeResult(result);
  }
}

function toCount(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  throw new Error("同步查询返回了无效计数");
}

function closeResult(result: QueryResult | QueryResult[] | undefined): void {
  const results = Array.isArray(result) ? result : result === undefined ? [] : [result];

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

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
