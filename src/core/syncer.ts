import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import nodePath from "node:path";

import { Connection, Database, type QueryResult } from "kuzu";

import { getLanguageAdapter, type LanguageAdapter } from "../ast/registry.js";
import { configPath, readConfig } from "./config.js";
import { scanProjectFiles } from "./scanner.js";
import { getKuzuDatabasePath, schemaStatements } from "./store.js";
import type { NormalizedPath, ParsedFile, ParsedSymbol } from "../ast/types.js";
import type { ScannedProjectFile, SyncResult } from "./project-types.js";

export type SyncProjectOptions = {
  readonly onProgress?: SyncProgressReporter;
};

export type SyncProgressReporter = (message: string) => void;

type HashedProjectFile = {
  readonly file: ScannedProjectFile;
  readonly content: string;
  readonly contentHash: string;
  readonly adapter: LanguageAdapter;
};

export async function syncProject(
  projectRoot: string,
  options: SyncProjectOptions = {},
): Promise<SyncResult> {
  const resolvedProjectRoot = nodePath.resolve(projectRoot);

  await assertExistingDirectory(resolvedProjectRoot, projectRoot);

  const config = await readConfig(resolvedProjectRoot);
  if (config === undefined) {
    throw new Error(`项目缺少配置文件：${nodePath.join(resolvedProjectRoot, configPath)}`);
  }

  reportProgress(options, "开始扫描项目文件");
  const files = await scanProjectFiles(resolvedProjectRoot, config);
  reportProgress(options, `扫描到 ${files.length} 个项目文件`);
  const currentFiles = await hashProjectFiles(resolvedProjectRoot, files);
  const databaseDir = nodePath.resolve(resolvedProjectRoot, config.databaseDir);
  const databasePath = getKuzuDatabasePath(databaseDir);

  await mkdir(databaseDir, { recursive: true });

  const database = new Database(databasePath);
  const connection = new Connection(database);

  try {
    await initializeSchema(connection);

    reportProgress(options, "开始对比 contentHash");
    const indexedFileHashes = await queryIndexedFileHashes(connection);
    const currentFilePaths = new Set(currentFiles.map((file) => file.file.path));
    const changedFiles = currentFiles.filter(
      (file) => indexedFileHashes.get(file.file.path) !== file.contentHash,
    );
    const removedFilePaths = [...indexedFileHashes.keys()].filter(
      (path) => !currentFilePaths.has(path),
    );
    reportProgress(options, `待刷新 ${changedFiles.length} 个文件，待删除 ${removedFilePaths.length} 个文件`);

    const affectedFilePaths = [
      ...removedFilePaths,
      ...changedFiles.map((file) => file.file.path),
    ];

    await deleteRelationshipsByAdapter(connection, affectedFilePaths);
    await removeIndexedFiles(connection, affectedFilePaths);
    await writeChangedFiles(connection, changedFiles, options);
    let callsCount = 0;
    let extendsCount = 0;
    let requiresCount = 0;
    if (affectedFilePaths.length > 0) {
      for (const [adapter, parsedFiles] of parseFilesByAdapter(currentFiles)) {
        reportProgress(options, "开始重建 Calls");
        callsCount += await adapter.rebuildCallsRelationships(connection, parsedFiles);
        reportProgress(options, "开始重建 Extends");
        extendsCount += await adapter.rebuildExtendsRelationships(connection, parsedFiles);
        reportProgress(options, "开始重建 Requires");
        requiresCount += await adapter.rebuildRequiresRelationships(connection, parsedFiles);
      }
    } else {
      reportProgress(options, "跳过重建 Calls：无变更文件");
      reportProgress(options, "跳过重建 Extends：无变更文件");
      reportProgress(options, "跳过重建 Requires：无变更文件");
    }

    const symbolCount = await countQuery(connection, "MATCH (symbol:Symbol) RETURN count(symbol) AS count;");
    const containsCount = await countQuery(
      connection,
      "MATCH (:File)-[contains:Contains]->(:Symbol) RETURN count(contains) AS count;",
    );
    reportProgress(
      options,
      `完成统计：扫描 ${files.length}，刷新 ${changedFiles.length}，删除 ${removedFilePaths.length}，符号 ${symbolCount}，Contains ${containsCount}，Calls ${callsCount}，Extends ${extendsCount}，Requires ${requiresCount}`,
    );

    return {
      scannedFileCount: files.length,
      changedFileCount: changedFiles.length,
      removedFileCount: removedFilePaths.length,
      symbolCount,
      containsCount,
      extendsCount,
      requiresCount,
      databaseDir,
    };
  } finally {
    await connection.close();
    await database.close();
  }
}

async function hashProjectFiles(
  projectRoot: string,
  files: readonly ScannedProjectFile[],
): Promise<HashedProjectFile[]> {
  return Promise.all(
    files.map(async (file) => {
      const content = await readFile(nodePath.join(projectRoot, file.path), "utf8");

      return {
        file,
        content,
        contentHash: createContentHash(content),
        adapter: getLanguageAdapter(file.path),
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

async function deleteRelationshipsByAdapter(
  connection: Connection,
  filePaths: readonly NormalizedPath[],
): Promise<void> {
  for (const [adapter, paths] of groupPathsByAdapter(filePaths)) {
    await adapter.deleteCallsForFiles(connection, paths);
    await adapter.deleteExtendsForFiles(connection, paths);
    await adapter.deleteRequiresForFiles(connection, paths);
  }
}

function groupPathsByAdapter(filePaths: readonly NormalizedPath[]): Map<LanguageAdapter, NormalizedPath[]> {
  const groups = new Map<LanguageAdapter, NormalizedPath[]>();

  for (const filePath of filePaths) {
    const adapter = getLanguageAdapter(filePath);
    const group = groups.get(adapter) ?? [];
    group.push(filePath);
    groups.set(adapter, group);
  }

  return groups;
}

function parseFilesByAdapter(files: readonly HashedProjectFile[]): Map<LanguageAdapter, ParsedFile[]> {
  const groups = new Map<LanguageAdapter, ParsedFile[]>();

  for (const file of files) {
    const parsed = file.adapter.parseFile(file.file.path, file.content);
    const group = groups.get(file.adapter) ?? [];
    group.push(parsed);
    groups.set(file.adapter, group);
  }

  return groups;
}

async function writeChangedFiles(
  connection: Connection,
  files: readonly HashedProjectFile[],
  options: SyncProjectOptions,
): Promise<void> {
  for (const [index, file] of files.entries()) {
    const parsed = file.adapter.parseFile(file.file.path, file.content);

    await insertFile(connection, file, parsed.symbols.length);

    for (const symbol of parsed.symbols) {
      await insertSymbol(connection, symbol);
    }

    await insertContainsRelationships(connection, file.file.path, parsed.symbols);
    reportFileProgress(options, file.file.path, index + 1, files.length);
  }
}

function reportFileProgress(options: SyncProjectOptions, filePath: NormalizedPath, done: number, total: number): void {
  reportProgress(options, `同步文件[${done}/${total}] ${nodePath.basename(filePath)}`);
}

function reportProgress(options: SyncProjectOptions, message: string): void {
  options.onProgress?.(message);
}

async function insertFile(
  connection: Connection,
  file: HashedProjectFile,
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

async function insertSymbol(connection: Connection, symbol: ParsedSymbol): Promise<void> {
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
  symbols: readonly ParsedSymbol[],
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
