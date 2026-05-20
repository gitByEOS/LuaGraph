import { Connection, type QueryResult } from "kuzu";

import type { LuaCall, LuaSymbol } from "./types.js";

export type ParsedCallGraphFile = {
  readonly symbols: readonly LuaSymbol[];
  readonly calls: readonly LuaCall[];
};

export async function rebuildCallsRelationships(
  connection: Connection,
  files: readonly ParsedCallGraphFile[],
): Promise<number> {
  await deleteAllCallsRelationships(connection);

  return insertCallsRelationships(connection, files);
}

export async function deleteCallsForFiles(
  connection: Connection,
  filePaths: readonly string[],
): Promise<void> {
  const statement = await connection.prepare(
    "MATCH (source:Symbol)-[call:Calls]->(target:Symbol) WHERE source.filePath = $path OR target.filePath = $path DELETE call",
  );

  for (const path of filePaths) {
    closeResult(await connection.execute(statement, { path }));
  }
}

async function deleteAllCallsRelationships(connection: Connection): Promise<void> {
  closeResult(await connection.query("MATCH (:Symbol)-[call:Calls]->(:Symbol) DELETE call;"));
}

async function insertCallsRelationships(
  connection: Connection,
  files: readonly ParsedCallGraphFile[],
): Promise<number> {
  const symbols = files.flatMap((file) => [...file.symbols]);
  const symbolIndex = createSymbolIndex(symbols);
  const statement = await connection.prepare(
    "MATCH (source:Symbol {id: $sourceId}), (target:Symbol {id: $targetId}) CREATE (source)-[r:Calls]->(target) SET r.line = $line, r.`column` = $callColumn, r.isResolved = $isResolved",
  );
  let callsCount = 0;

  for (const file of files) {
    for (const call of file.calls) {
      const source = findCallerSymbol(file.symbols, call);
      const target = resolveCallTarget(file, call, symbolIndex);

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

type SymbolIndex = {
  readonly uniqueSymbols: ReadonlyMap<string, LuaSymbol>;
  readonly classesByName: ReadonlyMap<string, readonly LuaSymbol[]>;
};

function createSymbolIndex(symbols: readonly LuaSymbol[]): SymbolIndex {
  return {
    uniqueSymbols: createUniqueSymbolMap(symbols),
    classesByName: createClassesByNameMap(symbols),
  };
}

function createUniqueSymbolMap(symbols: readonly LuaSymbol[]): ReadonlyMap<string, LuaSymbol> {
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

function createClassesByNameMap(symbols: readonly LuaSymbol[]): ReadonlyMap<string, readonly LuaSymbol[]> {
  const groups = new Map<string, LuaSymbol[]>();

  for (const symbol of symbols) {
    if (symbol.kind !== "class") {
      continue;
    }

    groups.set(symbol.qualifiedName, [...(groups.get(symbol.qualifiedName) ?? []), symbol]);
  }

  return groups;
}

function resolveCallTarget(
  file: ParsedCallGraphFile,
  call: LuaCall,
  symbolIndex: SymbolIndex,
): LuaSymbol | undefined {
  const constructorTarget = resolveConstructorTarget(file, call, symbolIndex);

  return constructorTarget ?? symbolIndex.uniqueSymbols.get(call.calleeQualifiedName);
}

function resolveConstructorTarget(
  file: ParsedCallGraphFile,
  call: LuaCall,
  symbolIndex: SymbolIndex,
): LuaSymbol | undefined {
  const className = getConstructorClassName(call.calleeQualifiedName);

  if (className === undefined) {
    return undefined;
  }

  const localClass = findSingleClass(file.symbols, className);
  if (localClass !== undefined) {
    return localClass;
  }

  return findSingleClass(symbolIndex.classesByName.get(className) ?? [], className);
}

function getConstructorClassName(calleeQualifiedName: string): string | undefined {
  const match = /^(?<className>[A-Za-z_][A-Za-z0-9_]*)\.new$/.exec(calleeQualifiedName);

  return match?.groups?.className;
}

function findSingleClass(symbols: readonly LuaSymbol[], className: string): LuaSymbol | undefined {
  const classes = symbols.filter((symbol) => symbol.kind === "class" && symbol.qualifiedName === className);

  return classes.length === 1 ? classes[0] : undefined;
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

function closeResult(result: QueryResult | QueryResult[] | undefined): void {
  const results = Array.isArray(result) ? result : result === undefined ? [] : [result];

  for (const item of results) {
    item.close();
  }
}
