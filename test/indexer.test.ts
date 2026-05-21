import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Connection, Database, type QueryResult } from "kuzu";
import { afterEach, describe, expect, it } from "vitest";

import { indexProject } from "../src/indexer.js";
import { initializeProject } from "../src/init.js";
import { getKuzuDatabasePath } from "../src/store.js";

const tempRoots: string[] = [];

describe("indexProject", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("索引 Lua 文件并写入 Kuzu", async () => {
    const projectRoot = await createTempProject();
    await writeLuaFile(
      projectRoot,
      "src/player.lua",
      'Player = class("Player")\nfunction Player:move()\nend\n',
    );

    await initializeProject(projectRoot);

    const result = await indexProject(projectRoot);

    expect(result).toMatchObject({
      fileCount: 1,
      symbolCount: 2,
      containsCount: 2,
      callsCount: 0,
      extendsCount: 0,
      requiresCount: 0,
      databaseDir: join(projectRoot, ".luagraph/kuzu"),
    });
  });

  it("写入可解析的 Calls 关系", async () => {
    const projectRoot = await createTempProject();
    await writeLuaFile(
      projectRoot,
      "src/calls.lua",
      [
        "function foo()",
        "end",
        "M = {}",
        "function M.foo()",
        "end",
        "function obj:foo()",
        "end",
        "function init()",
        "  foo()",
        "  M.foo()",
        "  obj:foo()",
        "  missing()",
        "end",
      ].join("\n"),
    );

    await initializeProject(projectRoot);

    const result = await indexProject(projectRoot);

    expect(result.callsCount).toBe(3);
    await expect(readCalls(projectRoot)).resolves.toEqual([
      { source: "init", target: "M.foo", line: 10, column: 3, isResolved: true },
      { source: "init", target: "foo", line: 9, column: 3, isResolved: true },
      { source: "init", target: "obj:foo", line: 11, column: 3, isResolved: true },
    ]);
  });

  it("写入可解析的 Extends 关系", async () => {
    const projectRoot = await createTempProject();
    await writeLuaFile(
      projectRoot,
      "src/inherit.lua",
      [
        "Parent = {}",
        "Child = setmetatable({}, { __index = Parent })",
        "Self.__index = Self",
        "Dynamic = setmetatable({}, { __index = getParent() })",
      ].join("\n"),
    );

    await initializeProject(projectRoot);

    const result = await indexProject(projectRoot);

    expect(result).toMatchObject({
      fileCount: 1,
      symbolCount: 2,
      containsCount: 2,
    });
    await expect(readExtends(projectRoot)).resolves.toEqual([
      { child: "Child", parent: "Parent" },
    ]);
  });

  it("对空项目返回零计数", async () => {
    const projectRoot = await createTempProject();

    await initializeProject(projectRoot);

    await expect(indexProject(projectRoot)).resolves.toEqual({
      fileCount: 0,
      symbolCount: 0,
      containsCount: 0,
      callsCount: 0,
      extendsCount: 0,
      requiresCount: 0,
      databaseDir: join(projectRoot, ".luagraph/kuzu"),
    });
  });

  it("写入静态和动态 Requires 关系", async () => {
    const projectRoot = await createTempProject();
    await writeLuaFile(
      projectRoot,
      "src/main.lua",
      ['local util = require("utils")', 'local dynamic = require("base." .. name)'].join("\n"),
    );
    await writeLuaFile(projectRoot, "src/utils.lua", "local M = {}\nreturn M\n");

    await initializeProject(projectRoot);

    const result = await indexProject(projectRoot);

    expect(result.requiresCount).toBe(2);
    await expect(readRequires(projectRoot)).resolves.toEqual([
      {
        source: "src/main.lua",
        target: "src/main.lua",
        moduleName: '"base." .. name',
        isResolved: false,
      },
      {
        source: "src/main.lua",
        target: "src/utils.lua",
        moduleName: "utils",
        isResolved: true,
      },
    ]);
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "luagraph-index-"));
  tempRoots.push(projectRoot);
  return projectRoot;
}

async function writeLuaFile(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const targetPath = join(projectRoot, relativePath);

  await mkdir(join(targetPath, ".."), { recursive: true });
  await writeFile(targetPath, content, "utf8");
}

async function readExtends(projectRoot: string): Promise<Record<string, unknown>[]> {
  const database = new Database(
    getKuzuDatabasePath(join(projectRoot, ".luagraph/kuzu")),
    undefined,
    undefined,
    true,
  );
  const connection = new Connection(database);
  let result: QueryResult | QueryResult[] | undefined;

  try {
    result = await connection.query(
      `MATCH (child:Symbol)-[extend:Extends]->(parent:Symbol)
RETURN child.qualifiedName AS child, parent.qualifiedName AS parent
ORDER BY child.qualifiedName;`,
    );
    const queryResult = Array.isArray(result) ? result[0] : result;
    const rows = (await queryResult?.getAll()) ?? [];

    return rows.map((row) => ({
      child: String(row.child),
      parent: String(row.parent),
    }));
  } finally {
    closeQueryResult(result);
    await connection.close();
    await database.close();
  }
}

async function readCalls(projectRoot: string): Promise<Record<string, unknown>[]> {
  const database = new Database(
    getKuzuDatabasePath(join(projectRoot, ".luagraph/kuzu")),
    undefined,
    undefined,
    true,
  );
  const connection = new Connection(database);
  let result: QueryResult | QueryResult[] | undefined;

  try {
    result = await connection.query(
      `MATCH (source:Symbol)-[call:Calls]->(target:Symbol)
RETURN source.qualifiedName AS source, target.qualifiedName AS target, call.line AS line,
  call.\`column\` AS callColumn, call.isResolved AS isResolved
ORDER BY target.qualifiedName;`,
    );
    const queryResult = Array.isArray(result) ? result[0] : result;
    const rows = (await queryResult?.getAll()) ?? [];

    return rows.map((row) => ({
      source: String(row.source),
      target: String(row.target),
      line: Number(row.line),
      column: Number(row.callColumn),
      isResolved: row.isResolved,
    }));
  } finally {
    closeQueryResult(result);
    await connection.close();
    await database.close();
  }
}

async function readRequires(projectRoot: string): Promise<Record<string, unknown>[]> {
  const database = new Database(
    getKuzuDatabasePath(join(projectRoot, ".luagraph/kuzu")),
    undefined,
    undefined,
    true,
  );
  const connection = new Connection(database);
  let result: QueryResult | QueryResult[] | undefined;

  try {
    result = await connection.query(
      `MATCH (source:File)-[require:Requires]->(target:File)
RETURN source.path AS source, target.path AS target,
  require.moduleName AS moduleName, require.isResolved AS isResolved
ORDER BY require.isResolved, target.path;`,
    );
    const queryResult = Array.isArray(result) ? result[0] : result;
    const rows = (await queryResult?.getAll()) ?? [];

    return rows.map((row) => ({
      source: String(row.source),
      target: String(row.target),
      moduleName: String(row.moduleName),
      isResolved: row.isResolved,
    }));
  } finally {
    closeQueryResult(result);
    await connection.close();
    await database.close();
  }
}

function closeQueryResult(result: QueryResult | QueryResult[] | undefined): void {
  const results = Array.isArray(result) ? result : result === undefined ? [] : [result];

  for (const item of results) {
    item.close();
  }
}
