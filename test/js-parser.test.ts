import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Connection, Database, type QueryResult } from "kuzu";
import { afterEach, describe, expect, it } from "vitest";

import { resolveJsModulePath } from "../src/ast/js/module-resolver.js";
import { parseJsFile } from "../src/ast/js/parser.js";
import {
  rebuildCallsRelationships,
  rebuildExtendsRelationships,
  rebuildRequiresRelationships,
} from "../src/ast/js/relationship-graph.js";
import type { NormalizedPath, ParsedFile, ParsedSymbol } from "../src/ast/types.js";
import { getKuzuDatabasePath, initializeStore } from "../src/core/store.js";

const tempRoots: string[] = [];

describe("JS/TS AST 适配器", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("统一解析 function、class、method、import、export、require、dynamic import 和 extends", () => {
    const source = [
      'import util from "./util";',
      'import type { User } from "./types";',
      'export { helper } from "./helper";',
      'const dep = require("./dep");',
      "const dynamicDep = require(depName);",
      'const lazy = import("./lazy");',
      "class Base {",
      "  base() {}",
      "}",
      "export class Child extends Base {",
      "  run() {",
      "    helper();",
      "    util();",
      "  }",
      "}",
      "export function helper() {",
      "  return dep;",
      "}",
      "const localArrow = () => new Child();",
    ].join("\n");

    const file = parseJsFile("src/main.tsx", source);

    expect(file.symbols.map((symbol) => [symbol.kind, symbol.qualifiedName, symbol.isExported])).toEqual([
      ["class", "Base", false],
      ["method", "Base.base", false],
      ["class", "Child", true],
      ["method", "Child.run", true],
      ["function", "helper", true],
      ["function", "localArrow", false],
    ]);
    expect(file.extends).toEqual([
      {
        type: "Extends",
        filePath: "src/main.tsx",
        childQualifiedName: "Child",
        parentQualifiedName: "Base",
        line: 10,
        column: 1,
      },
    ]);
    expect(file.requires.map((require) => [require.moduleName, require.isStatic])).toEqual([
      ["./util", true],
      ["./helper", true],
      ["./dep", true],
      ["depName", false],
      ["./lazy", true],
    ]);
    expect(file.calls.map((call) => call.calleeQualifiedName)).toEqual([
      "require",
      "require",
      "import",
      "helper",
      "util",
      "Child",
    ]);
  });

  it("按相对路径、扩展名、index 文件和 tsconfig paths 解析模块", () => {
    const files = [
      "src/util.ts",
      "src/feature/index.tsx",
      "src/shared/helper.ts",
      "node_modules/pkg/index.js",
    ] as NormalizedPath[];

    expect(resolveJsModulePath("src/main.ts" as NormalizedPath, "./util", files)).toBe("src/util.ts");
    expect(resolveJsModulePath("src/main.ts" as NormalizedPath, "./util.js", files)).toBe("src/util.ts");
    expect(resolveJsModulePath("src/main.ts" as NormalizedPath, "./feature", files)).toBe("src/feature/index.tsx");
    expect(
      resolveJsModulePath("src/main.ts" as NormalizedPath, "@/shared/helper", files, {
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@/*": ["src/*"],
          },
        },
      }),
    ).toBe("src/shared/helper.ts");
    expect(resolveJsModulePath("src/main.ts" as NormalizedPath, "pkg", files)).toBeUndefined();
  });

  it("重建 Calls、Extends、Requires 关系", async () => {
    const databaseDir = await createTempDatabase();
    const database = new Database(getKuzuDatabasePath(databaseDir));
    const connection = new Connection(database);
    const files = [
      parseJsFile(
        "src/main.ts",
        [
          'import "./util";',
          'const dynamicDep = require(depName);',
          "class Base {}",
          "class Child extends Base {",
          "  run() {",
          "    helper();",
          "  }",
          "}",
          "function helper() {}",
        ].join("\n"),
      ),
      parseJsFile("src/util.ts", "export function util() {}"),
    ];

    try {
      await insertParsedFiles(connection, files);

      await expect(rebuildCallsRelationships(connection, files)).resolves.toBe(1);
      await expect(rebuildExtendsRelationships(connection, files)).resolves.toBe(1);
      await expect(rebuildRequiresRelationships(connection, files)).resolves.toBe(2);

      await expect(readCalls(connection)).resolves.toEqual([{ source: "Child.run", target: "helper" }]);
      await expect(readExtends(connection)).resolves.toEqual([{ child: "Child", parent: "Base" }]);
      await expect(readRequires(connection)).resolves.toEqual([
        { source: "src/main.ts", target: "src/main.ts", moduleName: "depName", isResolved: false },
        { source: "src/main.ts", target: "src/util.ts", moduleName: "./util", isResolved: true },
      ]);
    } finally {
      await connection.close();
      await database.close();
    }
  });
});

async function createTempDatabase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "luagraph-js-"));
  const databaseDir = join(root, ".luagraph/kuzu");
  tempRoots.push(root);
  await initializeStore(databaseDir);

  return databaseDir;
}

async function insertParsedFiles(connection: Connection, files: readonly ParsedFile[]): Promise<void> {
  for (const file of files) {
    closeResult(await connection.query(`CREATE (:File {path: "${file.path}"});`));
    for (const symbol of file.symbols) {
      await insertSymbol(connection, symbol);
    }
  }
}

async function insertSymbol(connection: Connection, symbol: ParsedSymbol): Promise<void> {
  const statement = await connection.prepare(
    "CREATE (:Symbol {id: $id, kind: $kind, name: $name, qualifiedName: $qualifiedName, filePath: $filePath, startLine: $startLine, endLine: $endLine, startColumn: $startColumn, endColumn: $endColumn, signature: $signature, isLocal: $isLocal, isExported: $isExported, isUnresolved: $isUnresolved});",
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
      signature: symbol.signature,
      isLocal: symbol.isLocal,
      isExported: symbol.isExported,
      isUnresolved: symbol.isUnresolved,
    }),
  );
}

async function readCalls(connection: Connection): Promise<Record<string, unknown>[]> {
  const result = await connection.query(
    "MATCH (source:Symbol)-[:Calls]->(target:Symbol) RETURN source.qualifiedName AS source, target.qualifiedName AS target ORDER BY source.qualifiedName, target.qualifiedName;",
  );

  try {
    const rows = await readRows(result);

    return rows.map((row) => ({
      source: String(row.source),
      target: String(row.target),
    }));
  } finally {
    closeResult(result);
  }
}

async function readExtends(connection: Connection): Promise<Record<string, unknown>[]> {
  const result = await connection.query(
    "MATCH (child:Symbol)-[:Extends]->(parent:Symbol) RETURN child.qualifiedName AS child, parent.qualifiedName AS parent ORDER BY child.qualifiedName;",
  );

  try {
    const rows = await readRows(result);

    return rows.map((row) => ({
      child: String(row.child),
      parent: String(row.parent),
    }));
  } finally {
    closeResult(result);
  }
}

async function readRequires(connection: Connection): Promise<Record<string, unknown>[]> {
  const result = await connection.query(
    "MATCH (source:File)-[require:Requires]->(target:File) RETURN source.path AS source, target.path AS target, require.moduleName AS moduleName, require.isResolved AS isResolved ORDER BY require.isResolved, target.path;",
  );

  try {
    const rows = await readRows(result);

    return rows.map((row) => ({
      source: String(row.source),
      target: String(row.target),
      moduleName: String(row.moduleName),
      isResolved: row.isResolved,
    }));
  } finally {
    closeResult(result);
  }
}

async function readRows(result: QueryResult | QueryResult[]): Promise<Record<string, unknown>[]> {
  const queryResult = Array.isArray(result) ? result[0] : result;

  return ((await queryResult?.getAll()) ?? []) as Record<string, unknown>[];
}

function closeResult(result: QueryResult | QueryResult[] | undefined): void {
  const results = Array.isArray(result) ? result : result === undefined ? [] : [result];

  for (const item of results) {
    item.close();
  }
}
