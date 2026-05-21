import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { Connection, Database, type QueryResult } from "kuzu";

import { indexProject } from "../src/core/indexer.js";
import { initializeProject } from "../src/core/init.js";
import { getProjectStatus } from "../src/core/status.js";
import { getKuzuDatabasePath } from "../src/core/store.js";

const tempRoots: string[] = [];

describe("getProjectStatus", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("统计真实初始化后的空项目", async () => {
    const projectRoot = await createTempProject();

    await initializeProject(projectRoot);

    await expect(getProjectStatus(projectRoot)).resolves.toEqual({
      fileCount: 0,
      symbolCount: 0,
      edgeCount: 0,
      parseErrorCount: 0,
      symbolKindCounts: {},
      pendingSyncChangeCount: 0,
      databaseDir: join(projectRoot, ".luagraph/kuzu"),
      configPath: join(projectRoot, ".luagraph/config.json"),
      schemaCount: 8,
    });
  });

  it("索引后输出符号分类和同步状态", async () => {
    const projectRoot = await createTempProject();

    await writeLuaFile(
      projectRoot,
      "src/player.lua",
      'Player = class("Player")\nDinerConfig = {\n}\nfunction Player:move()\nend\nfunction spawnPlayer()\nend\n',
    );
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    await expect(getProjectStatus(projectRoot)).resolves.toMatchObject({
      fileCount: 1,
      symbolCount: 4,
      edgeCount: 4,
      parseErrorCount: 0,
      symbolKindCounts: {
        class: 1,
        function: 1,
        method: 1,
        table: 1,
      },
      pendingSyncChangeCount: 0,
    });
    await expect(readFileNodeCount(projectRoot, "src/player.lua")).resolves.toBe(4);
  });

  it("统计新增修改删除的待同步 Lua 文件", async () => {
    const projectRoot = await createTempProject();

    await writeLuaFile(projectRoot, "src/changed.lua", "function before()\nend\n");
    await writeLuaFile(projectRoot, "src/deleted.lua", "function removed()\nend\n");
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    await writeLuaFile(projectRoot, "src/changed.lua", "function after()\nend\n");
    await writeLuaFile(projectRoot, "src/added.lua", "function added()\nend\n");
    await rm(join(projectRoot, "src/deleted.lua"));

    const status = await getProjectStatus(projectRoot);

    expect(status.pendingSyncChangeCount).toBe(3);
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "luagraph-status-"));
  tempRoots.push(projectRoot);
  return projectRoot;
}

async function writeLuaFile(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const targetPath = join(projectRoot, relativePath);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
}

async function readFileNodeCount(projectRoot: string, filePath: string): Promise<number> {
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
      `MATCH (file:File {path: '${filePath}'}) RETURN file.nodeCount AS nodeCount;`,
    );
    const queryResult = Array.isArray(result) ? result[0] : result;
    const rows = await queryResult?.getAll();
    const nodeCount = rows?.[0]?.nodeCount;

    return typeof nodeCount === "bigint" ? Number(nodeCount) : Number(nodeCount);
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
