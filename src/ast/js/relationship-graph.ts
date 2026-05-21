import { Connection, type QueryResult } from "kuzu";

import { resolveJsModulePath } from "./module-resolver.js";
import type { NormalizedPath, ParsedCall, ParsedExtend, ParsedFile, ParsedRequire, ParsedSymbol } from "../types.js";

export async function rebuildCallsRelationships(
  connection: Connection,
  files: readonly ParsedFile[],
): Promise<number> {
  await deleteAllCallsRelationships(connection);

  return insertCallsRelationships(connection, files);
}

export async function rebuildExtendsRelationships(
  connection: Connection,
  files: readonly ParsedFile[],
): Promise<number> {
  await deleteAllExtendsRelationships(connection);

  return insertExtendsRelationships(connection, files);
}

export async function rebuildRequiresRelationships(
  connection: Connection,
  files: readonly ParsedFile[],
): Promise<number> {
  await deleteAllRequiresRelationships(connection);

  return insertRequiresRelationships(connection, files);
}

export async function deleteCallsForFiles(
  connection: Connection,
  filePaths: readonly NormalizedPath[],
): Promise<void> {
  const statement = await connection.prepare(
    "MATCH (source:Symbol)-[call:Calls]->(target:Symbol) WHERE source.filePath = $path OR target.filePath = $path DELETE call",
  );

  for (const path of filePaths) {
    closeResult(await connection.execute(statement, { path }));
  }
}

export async function deleteExtendsForFiles(
  connection: Connection,
  filePaths: readonly NormalizedPath[],
): Promise<void> {
  const statement = await connection.prepare(
    "MATCH (source:Symbol)-[extend:Extends]->(target:Symbol) WHERE source.filePath = $path OR target.filePath = $path DELETE extend",
  );

  for (const path of filePaths) {
    closeResult(await connection.execute(statement, { path }));
  }
}

export async function deleteRequiresForFiles(
  connection: Connection,
  filePaths: readonly NormalizedPath[],
): Promise<void> {
  const statement = await connection.prepare(
    "MATCH (source:File)-[require:Requires]->(target:File) WHERE source.path = $path OR target.path = $path DELETE require",
  );

  for (const path of filePaths) {
    closeResult(await connection.execute(statement, { path }));
  }
}

async function deleteAllCallsRelationships(connection: Connection): Promise<void> {
  closeResult(await connection.query("MATCH (:Symbol)-[call:Calls]->(:Symbol) DELETE call;"));
}

async function deleteAllExtendsRelationships(connection: Connection): Promise<void> {
  closeResult(await connection.query("MATCH (:Symbol)-[extend:Extends]->(:Symbol) DELETE extend;"));
}

async function deleteAllRequiresRelationships(connection: Connection): Promise<void> {
  closeResult(await connection.query("MATCH (:File)-[require:Requires]->(:File) DELETE require;"));
}

async function insertCallsRelationships(connection: Connection, files: readonly ParsedFile[]): Promise<number> {
  const symbolIndex = createSymbolIndex(files.flatMap((file) => [...file.symbols]));
  const statement = await connection.prepare(
    "MATCH (source:Symbol {id: $sourceId}), (target:Symbol {id: $targetId}) CREATE (source)-[r:Calls]->(target) SET r.line = $line, r.`column` = $callColumn, r.isResolved = $isResolved",
  );
  let callsCount = 0;

  for (const file of files) {
    for (const call of file.calls) {
      const source = findCallerSymbol(file.symbols, call);
      const target = resolveCallTarget(call, symbolIndex);

      if (source === undefined || target === undefined) {
        continue;
      }

      closeResult(
        await connection.execute(statement, {
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

async function insertExtendsRelationships(connection: Connection, files: readonly ParsedFile[]): Promise<number> {
  const symbolIndex = createSymbolIndex(files.flatMap((file) => [...file.symbols]));
  const statement = await connection.prepare(
    "MATCH (child:Symbol {id: $childId}), (parent:Symbol {id: $parentId}) CREATE (child)-[r:Extends]->(parent)",
  );
  let extendsCount = 0;

  for (const file of files) {
    for (const relationship of file.extends) {
      const child = resolveLocalSymbol(file.symbols, relationship.childQualifiedName, relationship.line);
      const parent = resolveExtendsParent(file.symbols, relationship, symbolIndex);

      if (child === undefined || parent === undefined || child.id === parent.id) {
        continue;
      }

      closeResult(await connection.execute(statement, { childId: child.id, parentId: parent.id }));
      extendsCount += 1;
    }
  }

  return extendsCount;
}

async function insertRequiresRelationships(connection: Connection, files: readonly ParsedFile[]): Promise<number> {
  const filePaths = files.map((file) => file.path);
  const statement = await connection.prepare(
    "MATCH (source:File {path: $sourcePath}), (target:File {path: $targetPath}) CREATE (source)-[r:Requires]->(target) SET r.moduleName = $moduleName, r.isResolved = $isResolved",
  );
  let requiresCount = 0;

  for (const file of files) {
    for (const require of file.requires) {
      const targetPath = resolveRequireTarget(file.path, require, filePaths);

      closeResult(
        await connection.execute(statement, {
          sourcePath: file.path,
          targetPath: targetPath ?? file.path,
          moduleName: require.moduleName,
          isResolved: targetPath !== undefined,
        }),
      );
      requiresCount += 1;
    }
  }

  return requiresCount;
}

type SymbolIndex = {
  readonly uniqueSymbols: ReadonlyMap<string, ParsedSymbol>;
};

function createSymbolIndex(symbols: readonly ParsedSymbol[]): SymbolIndex {
  return {
    uniqueSymbols: createUniqueSymbolMap(symbols),
  };
}

function createUniqueSymbolMap(symbols: readonly ParsedSymbol[]): ReadonlyMap<string, ParsedSymbol> {
  const groups = new Map<string, ParsedSymbol[]>();

  for (const symbol of symbols) {
    groups.set(symbol.qualifiedName, [...(groups.get(symbol.qualifiedName) ?? []), symbol]);
  }

  return new Map(
    [...groups]
      .filter((entry): entry is [string, [ParsedSymbol]] => entry[1].length === 1)
      .map(([qualifiedName, [symbol]]) => [qualifiedName, symbol]),
  );
}

function resolveCallTarget(call: ParsedCall, symbolIndex: SymbolIndex): ParsedSymbol | undefined {
  return symbolIndex.uniqueSymbols.get(call.calleeQualifiedName);
}

function resolveExtendsParent(
  localSymbols: readonly ParsedSymbol[],
  relationship: ParsedExtend,
  symbolIndex: SymbolIndex,
): ParsedSymbol | undefined {
  return (
    resolveSingleLocalSymbol(localSymbols, relationship.parentQualifiedName) ??
    symbolIndex.uniqueSymbols.get(relationship.parentQualifiedName)
  );
}

function resolveRequireTarget(
  sourcePath: NormalizedPath,
  require: ParsedRequire,
  filePaths: readonly NormalizedPath[],
): NormalizedPath | undefined {
  return require.isStatic ? resolveJsModulePath(sourcePath, require.moduleName, filePaths) : undefined;
}

function resolveLocalSymbol(
  symbols: readonly ParsedSymbol[],
  qualifiedName: string,
  line: number,
): ParsedSymbol | undefined {
  return symbols.find((symbol) => symbol.qualifiedName === qualifiedName && symbol.startLine === line);
}

function resolveSingleLocalSymbol(
  symbols: readonly ParsedSymbol[],
  qualifiedName: string,
): ParsedSymbol | undefined {
  const matches = symbols.filter((symbol) => symbol.qualifiedName === qualifiedName);

  return matches.length === 1 ? matches[0] : undefined;
}

function findCallerSymbol(symbols: readonly ParsedSymbol[], call: ParsedCall): ParsedSymbol | undefined {
  return symbols
    .filter((symbol) => isCallableSymbol(symbol) && containsLine(symbol, call.line))
    .sort(compareSymbolScope)[0];
}

function isCallableSymbol(symbol: ParsedSymbol): boolean {
  return symbol.kind === "function" || symbol.kind === "method";
}

function containsLine(symbol: ParsedSymbol, line: number): boolean {
  return symbol.startLine <= line && line <= symbol.endLine;
}

function compareSymbolScope(left: ParsedSymbol, right: ParsedSymbol): number {
  const leftSpan = left.endLine - left.startLine;
  const rightSpan = right.endLine - right.startLine;

  return leftSpan - rightSpan || right.startLine - left.startLine;
}

function closeResult(result: QueryResult | QueryResult[] | undefined): void {
  const results = Array.isArray(result) ? result : result === undefined ? [] : [result];

  for (const item of results) {
    item.close();
  }
}
