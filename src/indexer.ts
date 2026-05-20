import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import nodePath from "node:path";

import { Connection, Database, type QueryResult } from "kuzu";

import { readConfig } from "./config.js";
import { parseLuaFile } from "./parser.js";
import { scanLuaFiles } from "./scanner.js";
import { getKuzuDatabasePath, schemaStatements } from "./store.js";
import type { IndexResult, LuaSymbol, NormalizedPath, ScannedLuaFile } from "./types.js";

export type IndexProjectOptions = {
  readonly force?: boolean;
  readonly onProgress?: IndexProgressReporter;
};

export type IndexProgressReporter = (message: string) => void;

const FILE_PROGRESS_INTERVAL = 25;

export async function indexProject(
  projectRoot: string,
  options: IndexProjectOptions = {},
): Promise<IndexResult> {
  const resolvedProjectRoot = nodePath.resolve(projectRoot);
  const config = await readConfig(resolvedProjectRoot);

  if (config === undefined) {
    throw new Error(`未找到配置文件: ${resolvedProjectRoot}/.luagraph/config.json`);
  }

  reportProgress(options, "开始扫描 Lua 文件");
  const files = await scanLuaFiles(resolvedProjectRoot, config);
  reportProgress(options, `扫描到 ${files.length} 个 Lua 文件`);
  const databaseDir = nodePath.resolve(resolvedProjectRoot, config.databaseDir);
  const databasePath = getKuzuDatabasePath(databaseDir);

  await rm(options.force === true ? databaseDir : databasePath, { recursive: true, force: true });
  await mkdir(databaseDir, { recursive: true });

  const database = new Database(databasePath);
  const connection = new Connection(database);

  let symbolCount = 0;
  let containsCount = 0;

  try {
    await initializeSchema(connection);
    reportProgress(options, "开始索引 Lua 符号");

    for (const [index, file] of files.entries()) {
      const content = await readFile(nodePath.join(resolvedProjectRoot, file.path), "utf8");
      const parsed = parseLuaFile(file.path, content);

      await insertFile(connection, file, content, parsed.symbols.length);

      for (const symbol of parsed.symbols) {
        await insertSymbol(connection, symbol);
        symbolCount += 1;
      }

      await insertContainsRelationships(connection, file.path, parsed.symbols);
      containsCount += parsed.symbols.length;
      reportFileProgress(options, index + 1, files.length);
    }
  } finally {
    await connection.close();
    await database.close();
  }

  reportProgress(
    options,
    `完成统计：文件 ${files.length}，符号 ${symbolCount}，Contains ${containsCount}`,
  );

  return {
    fileCount: files.length,
    symbolCount,
    containsCount,
    databaseDir,
  };
}

function reportFileProgress(options: IndexProjectOptions, done: number, total: number): void {
  if (done !== total && done % FILE_PROGRESS_INTERVAL !== 0) {
    return;
  }

  reportProgress(options, `已索引 ${done}/${total} 个 Lua 文件`);
}

function reportProgress(options: IndexProjectOptions, message: string): void {
  options.onProgress?.(message);
}

async function initializeSchema(connection: Connection): Promise<void> {
  for (const statement of schemaStatements) {
    closeResult(await connection.query(statement.cypher));
  }
}

async function insertFile(
  connection: Connection,
  file: ScannedLuaFile,
  content: string,
  nodeCount: number,
): Promise<void> {
  const contentHash = createHash("sha256").update(content).digest("hex");
  const now = new Date();

  const stmt = await connection.prepare(
    "MERGE (n:File {path: $path}) SET n.contentHash = $contentHash, n.size = $size, n.modifiedAt = $modifiedAt, n.indexedAt = $indexedAt, n.nodeCount = $nodeCount, n.error = $error",
  );
  closeResult(
    await connection.execute(stmt, {
      path: file.path,
      contentHash,
      size: BigInt(file.size),
      modifiedAt: file.modifiedAt,
      indexedAt: now,
      nodeCount: BigInt(nodeCount),
      error: "",
    }),
  );
}

async function insertSymbol(connection: Connection, symbol: LuaSymbol): Promise<void> {
  const now = new Date();

  const stmt = await connection.prepare(
    "MERGE (n:Symbol {id: $id}) SET n.kind = $kind, n.name = $name, n.qualifiedName = $qualifiedName, n.filePath = $filePath, n.startLine = $startLine, n.endLine = $endLine, n.startColumn = $startColumn, n.endColumn = $endColumn, n.docstring = $docstring, n.signature = $signature, n.isLocal = $isLocal, n.isExported = $isExported, n.isUnresolved = $isUnresolved, n.updatedAt = $updatedAt",
  );
  closeResult(
    await connection.execute(stmt, {
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
  const stmt = await connection.prepare(
    "MATCH (f:File {path: $fromPath}), (s:Symbol {id: $toId}) CREATE (f)-[r:Contains]->(s)",
  );

  for (const symbol of symbols) {
    closeResult(
      await connection.execute(stmt, {
        fromPath: filePath,
        toId: symbol.id,
      }),
    );
  }
}

function closeResult(result: QueryResult | QueryResult[]): void {
  const results = Array.isArray(result) ? result : [result];

  for (const item of results) {
    item.close();
  }
}
