import { createHash } from "node:crypto";
import { mkdir, rm, readdir, readFile, stat } from "node:fs/promises";
import nodePath from "node:path";

import { Connection, Database, type QueryResult } from "kuzu";

import { readConfig, validateConfig } from "./config.js";
import { normalizeRepositoryPath } from "./path.js";
import { parseLuaFile } from "./parser.js";
import { createPatternMatcher } from "./scanner.js";
import { getKuzuDatabasePath } from "./store.js";
import type {
  AnalyzeResult,
  LuaGraphConfig,
  LuaSymbol,
  NormalizedPath,
  ScannedLuaFile,
} from "./types.js";

export async function analyzeProject(
  projectRoot: string,
  includePattern: string,
): Promise<AnalyzeResult> {
  const config = await readConfig(projectRoot);

  if (config === undefined) {
    throw new Error(`未找到配置文件: ${projectRoot}/.luagraph/config.json`);
  }

  validateConfig(config);

  const mergedConfig: LuaGraphConfig = {
    ...config,
    include: [includePattern],
  };

  const files = await scanLuaFiles(projectRoot, mergedConfig);

  const resolvedProjectRoot = nodePath.resolve(projectRoot);
  const databaseDir = nodePath.resolve(resolvedProjectRoot, config.databaseDir);

  const dbPath = getKuzuDatabasePath(databaseDir);

  await rm(dbPath, { recursive: true, force: true });
  await mkdir(nodePath.dirname(dbPath), { recursive: true });

  const database = new Database(dbPath);
  const connection = new Connection(database);

  let symbolCount = 0;
  let containsCount = 0;

  try {
    await initializeSchema(connection);

    for (const file of files) {
      const content = await readFile(nodePath.join(projectRoot, file.path), "utf8");

      const parsed = parseLuaFile(file.path, content);

      await insertFile(connection, file, content);

      for (const symbol of parsed.symbols) {
        await insertSymbol(connection, symbol);
        symbolCount += 1;
      }

      await insertContainsRelationships(connection, file.path, parsed.symbols);
      containsCount += parsed.symbols.length;
    }
  } finally {
    await connection.close();
    await database.close();
  }

  return {
    fileCount: files.length,
    symbolCount,
    containsCount,
    databaseDir,
  };
}

async function scanLuaFiles(
  projectRoot: string,
  config: LuaGraphConfig,
): Promise<ScannedLuaFile[]> {
  const includeMatcher = createPatternMatcher(config.include);
  const excludeMatcher = createPatternMatcher(config.exclude);
  const files: ScannedLuaFile[] = [];

  await scanDirectory("");

  return files.sort((left, right) => left.path.localeCompare(right.path));

  async function scanDirectory(relativeDirectory: string): Promise<void> {
    const absoluteDirectory =
      relativeDirectory === "" ? projectRoot : nodePath.join(projectRoot, relativeDirectory);
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = toRepositoryPath(relativeDirectory, entry.name);

      if (entry.isDirectory()) {
        if (!excludeMatcher(relativePath)) {
          await scanDirectory(relativePath);
        }
        continue;
      }

      if (!entry.isFile() || !relativePath.endsWith(".lua") || excludeMatcher(relativePath)) {
        continue;
      }

      if (!includeMatcher(relativePath)) {
        continue;
      }

      const fileStats = await stat(nodePath.join(projectRoot, relativePath));

      files.push({
        path: relativePath,
        size: fileStats.size,
        modifiedAt: fileStats.mtime,
      });
    }
  }
}

async function initializeSchema(connection: Connection): Promise<void> {
  const cyphers = [
    "CREATE NODE TABLE IF NOT EXISTS File(path STRING PRIMARY KEY, contentHash STRING, size UINT64, modifiedAt TIMESTAMP, indexedAt TIMESTAMP, nodeCount UINT64, error STRING);",
    "CREATE NODE TABLE IF NOT EXISTS Symbol(id STRING PRIMARY KEY, kind STRING, name STRING, qualifiedName STRING, filePath STRING, startLine UINT64, endLine UINT64, startColumn UINT64, endColumn UINT64, docstring STRING, signature STRING, isLocal BOOLEAN, isExported BOOLEAN, isUnresolved BOOLEAN, updatedAt TIMESTAMP);",
    "CREATE REL TABLE IF NOT EXISTS Contains(FROM File TO Symbol, FROM Symbol TO Symbol);",
  ];

  for (const cypher of cyphers) {
    closeResult(await connection.query(cypher));
  }
}

async function insertFile(
  connection: Connection,
  file: ScannedLuaFile,
  content: string,
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
      nodeCount: BigInt(0),
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

function toRepositoryPath(relativeDirectory: string, entryName: string): NormalizedPath {
  const relativePath = relativeDirectory === "" ? entryName : `${relativeDirectory}/${entryName}`;

  return normalizeRepositoryPath(relativePath);
}

function closeResult(result: QueryResult | QueryResult[]): void {
  const results = Array.isArray(result) ? result : [result];
  for (const item of results) {
    item.close();
  }
}
