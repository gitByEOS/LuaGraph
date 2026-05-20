import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { indexProject } from "../src/indexer.js";
import { initializeProject } from "../src/init.js";

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
      databaseDir: join(projectRoot, ".luagraph/kuzu"),
    });
  });

  it("对空项目返回零计数", async () => {
    const projectRoot = await createTempProject();

    await initializeProject(projectRoot);

    await expect(indexProject(projectRoot)).resolves.toEqual({
      fileCount: 0,
      symbolCount: 0,
      containsCount: 0,
      databaseDir: join(projectRoot, ".luagraph/kuzu"),
    });
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
