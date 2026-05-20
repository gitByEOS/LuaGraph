import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { indexProject } from "../src/indexer.js";
import { initializeProject } from "../src/init.js";
import { queryProject } from "../src/query.js";
import { getProjectStatus } from "../src/status.js";
import { syncProject } from "../src/syncer.js";

const tempRoots: string[] = [];

describe("syncProject", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("只刷新新增修改删除的 Lua 文件", async () => {
    const projectRoot = await createTempProject();

    await writeLuaFile(projectRoot, "src/stable.lua", "function stable()\nend\n");
    await writeLuaFile(projectRoot, "src/changed.lua", "function before()\nend\n");
    await writeLuaFile(projectRoot, "src/deleted.lua", "function removed()\nend\n");
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    await writeLuaFile(
      projectRoot,
      "src/changed.lua",
      "function after()\nend\nfunction afterAgain()\nend\n",
    );
    await writeLuaFile(projectRoot, "src/added.lua", "function added()\nend\n");
    await rm(join(projectRoot, "src/deleted.lua"));

    await expect(getProjectStatus(projectRoot)).resolves.toMatchObject({
      pendingSyncChangeCount: 3,
    });

    const result = await syncProject(projectRoot);

    expect(result).toMatchObject({
      scannedFileCount: 3,
      changedFileCount: 2,
      removedFileCount: 1,
      symbolCount: 4,
      containsCount: 4,
      databaseDir: join(projectRoot, ".luagraph/kuzu"),
    });
    await expect(getProjectStatus(projectRoot)).resolves.toMatchObject({
      fileCount: 3,
      symbolCount: 4,
      edgeCount: 4,
      pendingSyncChangeCount: 0,
    });
  });

  it("同步后重建 Calls 并移除旧调用边", async () => {
    const projectRoot = await createTempProject();

    await writeLuaFile(
      projectRoot,
      "src/main.lua",
      [
        "function foo()",
        "end",
        "function init()",
        "  foo()",
        "end",
        "function boot()",
        "  init()",
        "end",
      ].join("\n"),
    );
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    await expect(queryProject(projectRoot, "callees:init")).resolves.toMatchObject({
      count: 1,
      nodes: [{ qualifiedName: "foo" }],
    });

    await writeLuaFile(
      projectRoot,
      "src/main.lua",
      [
        "function foo()",
        "end",
        "function bar()",
        "end",
        "function init()",
        "  bar()",
        "end",
        "function boot()",
        "  init()",
        "end",
      ].join("\n"),
    );

    await syncProject(projectRoot);

    await expect(queryProject(projectRoot, "callees:init")).resolves.toMatchObject({
      count: 1,
      nodes: [{ qualifiedName: "bar" }],
    });
    await expect(queryProject(projectRoot, "callers:foo")).resolves.toMatchObject({
      count: 0,
      nodes: [],
      edges: [],
    });
    await expect(queryProject(projectRoot, "callers:bar")).resolves.toMatchObject({
      count: 1,
      nodes: [{ qualifiedName: "init" }],
    });
  });

  it("传入 onProgress 时报告同步进度", async () => {
    const projectRoot = await createTempProject();
    const messages: string[] = [];

    await writeLuaFile(projectRoot, "src/player.lua", "function before()\nend\n");
    await initializeProject(projectRoot);
    await indexProject(projectRoot);
    await writeLuaFile(projectRoot, "src/player.lua", "function after()\nend\n");

    await syncProject(projectRoot, { onProgress: (message) => messages.push(message) });

    expect(messages).toEqual(
      expect.arrayContaining([
        "开始扫描 Lua 文件",
        "扫描到 1 个 Lua 文件",
        "开始对比 contentHash",
        "待刷新 1 个文件，待删除 0 个文件",
        "同步文件[1/1] player.lua",
        "开始重建 Calls",
        "完成统计：扫描 1，刷新 1，删除 0，符号 1，Contains 1，Calls 0",
      ]),
    );
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "luagraph-sync-"));
  tempRoots.push(projectRoot);
  return projectRoot;
}

async function writeLuaFile(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const targetPath = join(projectRoot, relativePath);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
}
