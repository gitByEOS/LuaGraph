import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import nodePath from "node:path";

import { Connection, Database, type QueryResult } from "kuzu";

import { readConfig } from "./config.js";
import { parseLuaFile } from "./parser.js";
import { scanLuaFiles } from "./scanner.js";
import { getKuzuDatabasePath, schemaStatements } from "./store.js";
import type { IndexResult, LuaCall, LuaFile, LuaSymbol, NormalizedPath, ScannedLuaFile } from "./types.js";

export type IndexProjectOptions = {
  readonly force?: boolean;
  readonly onProgress?: IndexProgressReporter;
};

export type IndexProgressReporter = (message: string) => void;

type ParsedProjectFile = {
  readonly file: ScannedLuaFile;
  readonly content: string;
  readonly parsed: LuaFile;
};

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
  let callsCount = 0;

  try {
    await initializeSchema(connection);
    reportProgress(options, "开始索引 Lua 符号");
    const parsedFiles = await readParsedProjectFiles(resolvedProjectRoot, files);

    for (const [index, parsedFile] of parsedFiles.entries()) {
      const { file, content, parsed } = parsedFile;
      await insertFile(connection, file, content, parsed.symbols.length);

      for (const symbol of parsed.symbols) {
        await insertSymbol(connection, symbol);
        symbolCount += 1;
      }

      await insertContainsRelationships(connection, file.path, parsed.symbols);
      containsCount += parsed.symbols.length;
      reportFileProgress(options, file.path, index + 1, files.length);
    }

    callsCount = await insertCallsRelationships(connection, parsedFiles);
  } finally {
    await connection.close();
    await database.close();
  }

  reportProgress(
    options,
    `完成统计：文件 ${files.length}，符号 ${symbolCount}，Contains ${containsCount}，Calls ${callsCount}`,
  );

  return {
    fileCount: files.length,
    symbolCount,
    containsCount,
    callsCount,
    databaseDir,
  };
}

async function readParsedProjectFiles(
  projectRoot: string,
  files: readonly ScannedLuaFile[],
): Promise<ParsedProjectFile[]> {
  return Promise.all(
    files.map(async (file) => {
      const content = await readFile(nodePath.join(projectRoot, file.path), "utf8");

      return {
        file,
        content,
        parsed: parseLuaFile(file.path, content),
      };
    }),
  );
}

function reportFileProgress(options: IndexProjectOptions, filePath: NormalizedPath, done: number, total: number): void {
  reportProgress(options, `索引文件[${done}/${total}] ${nodePath.basename(filePath)} ...`);
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

async function insertCallsRelationships(
  connection: Connection,
  parsedFiles: readonly ParsedProjectFile[],
): Promise<number> {
  const symbols = parsedFiles.flatMap((file) => [...file.parsed.symbols]);
  const uniqueSymbols = createUniqueSymbolMap(symbols);
  const stmt = await connection.prepare(
    "MATCH (source:Symbol {id: $sourceId}), (target:Symbol {id: $targetId}) CREATE (source)-[r:Calls]->(target) SET r.line = $line, r.`column` = $callColumn, r.isResolved = $isResolved",
  );
  let callsCount = 0;

  for (const parsedFile of parsedFiles) {
    for (const call of parsedFile.parsed.calls) {
      const source = findCallerSymbol(parsedFile.parsed.symbols, call);
      const target = uniqueSymbols.get(call.calleeQualifiedName);

      if (source === undefined || target === undefined) {
        continue;
      }

      closeResult(
        await connection.execute(stmt, {
          sourceId: source.id,
          targetId: target.id,
          line: BigInt(call.line),
          callColumn: BigInt(call.column),
          isResolved: true,
        }),
      );
      callsCount += 1;
    }
  }

  return callsCount;
}

function createUniqueSymbolMap(symbols: readonly LuaSymbol[]): Map<string, LuaSymbol> {
  const groups = new Map<string, LuaSymbol[]>();

  for (const symbol of symbols) {
    groups.set(symbol.qualifiedName, [...(groups.get(symbol.qualifiedName) ?? []), symbol]);
  }

  return new Map(
    [...groups]
      .filter((entry): entry is [string, [LuaSymbol]] => entry[1].length === 1)
      .map(([qualifiedName, [symbol]]) => [qualifiedName, symbol]),
  );
}

function findCallerSymbol(symbols: readonly LuaSymbol[], call: LuaCall): LuaSymbol | undefined {
  return symbols
    .filter((symbol) => isCallableSymbol(symbol) && containsLine(symbol, call.line))
    .sort(compareSymbolScope)[0];
}

function isCallableSymbol(symbol: LuaSymbol): boolean {
  return symbol.kind === "function" || symbol.kind === "method";
}

function containsLine(symbol: LuaSymbol, line: number): boolean {
  return symbol.startLine <= line && line <= symbol.endLine;
}

function compareSymbolScope(left: LuaSymbol, right: LuaSymbol): number {
  const leftSpan = left.endLine - left.startLine;
  const rightSpan = right.endLine - right.startLine;

  return leftSpan - rightSpan || right.startLine - left.startLine;
}

function closeResult(result: QueryResult | QueryResult[]): void {
  const results = Array.isArray(result) ? result : [result];

  for (const item of results) {
    item.close();
  }
}
