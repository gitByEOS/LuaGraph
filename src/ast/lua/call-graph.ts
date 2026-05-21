import { Connection, type QueryResult } from "kuzu";

import type { NormalizedPath, ParsedCall, ParsedSymbol } from "../types.js";

export type ParsedCallGraphFile = {
  readonly path?: NormalizedPath;
  readonly symbols: readonly ParsedSymbol[];
  readonly calls: readonly ParsedCall[];
};

export async function rebuildCallsRelationships(
  connection: Connection,
  files: readonly ParsedCallGraphFile[],
): Promise<number> {
  await deleteCallsForFiles(connection, files.map(readFilePath).filter(isString));

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
  readonly uniqueSymbols: ReadonlyMap<string, ParsedSymbol>;
  readonly classesByName: ReadonlyMap<string, readonly ParsedSymbol[]>;
};

function createSymbolIndex(symbols: readonly ParsedSymbol[]): SymbolIndex {
  return {
    uniqueSymbols: createUniqueSymbolMap(symbols),
    classesByName: createClassesByNameMap(symbols),
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

function createClassesByNameMap(symbols: readonly ParsedSymbol[]): ReadonlyMap<string, readonly ParsedSymbol[]> {
  const groups = new Map<string, ParsedSymbol[]>();

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
  call: ParsedCall,
  symbolIndex: SymbolIndex,
): ParsedSymbol | undefined {
  const constructorTarget = resolveConstructorTarget(file, call, symbolIndex);

  return constructorTarget ?? symbolIndex.uniqueSymbols.get(call.calleeQualifiedName);
}

function resolveConstructorTarget(
  file: ParsedCallGraphFile,
  call: ParsedCall,
  symbolIndex: SymbolIndex,
): ParsedSymbol | undefined {
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

function findSingleClass(symbols: readonly ParsedSymbol[], className: string): ParsedSymbol | undefined {
  const classes = symbols.filter((symbol) => symbol.kind === "class" && symbol.qualifiedName === className);

  return classes.length === 1 ? classes[0] : undefined;
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

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

function readFilePath(file: ParsedCallGraphFile): string | undefined {
  return file.path ?? file.symbols[0]?.filePath;
}

function closeResult(result: QueryResult | QueryResult[] | undefined): void {
  const results = Array.isArray(result) ? result : result === undefined ? [] : [result];

  for (const item of results) {
    item.close();
  }
}
