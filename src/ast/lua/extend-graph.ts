import { Connection, type QueryResult } from "kuzu";

import type { ParsedExtend, ParsedSymbol } from "../types.js";

export type ParsedExtendsGraphFile = {
  readonly symbols: readonly ParsedSymbol[];
  readonly extends: readonly ParsedExtend[];
};

export async function rebuildExtendsRelationships(
  connection: Connection,
  files: readonly ParsedExtendsGraphFile[],
): Promise<number> {
  await deleteAllExtendsRelationships(connection);

  return insertExtendsRelationships(connection, files);
}

export async function deleteExtendsForFiles(
  connection: Connection,
  filePaths: readonly string[],
): Promise<void> {
  const statement = await connection.prepare(
    "MATCH (source:Symbol)-[extend:Extends]->(target:Symbol) WHERE source.filePath = $path OR target.filePath = $path DELETE extend",
  );

  for (const path of filePaths) {
    closeResult(await connection.execute(statement, { path }));
  }
}

async function deleteAllExtendsRelationships(connection: Connection): Promise<void> {
  closeResult(await connection.query("MATCH (:Symbol)-[extend:Extends]->(:Symbol) DELETE extend;"));
}

async function insertExtendsRelationships(
  connection: Connection,
  files: readonly ParsedExtendsGraphFile[],
): Promise<number> {
  const symbols = files.flatMap((file) => [...file.symbols]);
  const symbolIndex = createSymbolIndex(symbols);
  const statement = await connection.prepare(
    "MATCH (child:Symbol {id: $childId}), (parent:Symbol {id: $parentId}) CREATE (child)-[r:Extends]->(parent)",
  );
  let extendsCount = 0;

  for (const file of files) {
    for (const relationship of file.extends) {
      const child = resolveLocalSymbol(file.symbols, relationship.childQualifiedName, relationship.line);
      const parent = resolveParentSymbol(file.symbols, relationship, symbolIndex);

      if (child === undefined || parent === undefined || child.id === parent.id) {
        continue;
      }

      closeResult(
        await connection.execute(statement, {
          childId: child.id,
          parentId: parent.id,
        }),
      );
      extendsCount += 1;
    }
  }

  return extendsCount;
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

function resolveParentSymbol(
  localSymbols: readonly ParsedSymbol[],
  relationship: ParsedExtend,
  symbolIndex: SymbolIndex,
): ParsedSymbol | undefined {
  return (
    resolveSingleLocalSymbol(localSymbols, relationship.parentQualifiedName) ??
    symbolIndex.uniqueSymbols.get(relationship.parentQualifiedName)
  );
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

function closeResult(result: QueryResult | QueryResult[] | undefined): void {
  const results = Array.isArray(result) ? result : result === undefined ? [] : [result];

  for (const item of results) {
    item.close();
  }
}
