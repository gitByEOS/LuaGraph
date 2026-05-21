import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { indexProject } from "../src/core/indexer.js";
import { initializeProject } from "../src/core/init.js";
import { sampleProject } from "../src/core/sample.js";

const tempRoots: string[] = [];

describe("sampleProject", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("抽查 index 后的 class/function/method/local function", async () => {
    const projectRoot = await createIndexedProject();

    await expect(sampleProject(projectRoot)).resolves.toEqual({
      projectRoot,
      count: 4,
      symbols: [
        {
          kind: "class",
          name: "Player",
          qualifiedName: "Player",
          filePath: "src/player.lua",
          startLine: 1,
          isLocal: false,
          signature: 'Player = class("Player")',
        },
        {
          kind: "method",
          name: "move",
          qualifiedName: "Player:move",
          filePath: "src/player.lua",
          startLine: 2,
          isLocal: false,
          signature: "function Player:move()",
        },
        {
          kind: "function",
          name: "spawnPlayer",
          qualifiedName: "spawnPlayer",
          filePath: "src/player.lua",
          startLine: 4,
          isLocal: false,
          signature: "function spawnPlayer()",
        },
        {
          kind: "function",
          name: "buildLocal",
          qualifiedName: "buildLocal",
          filePath: "src/player.lua",
          startLine: 6,
          isLocal: true,
          signature: "local function buildLocal()",
        },
      ],
    });
  });

  it("限制返回数量", async () => {
    const projectRoot = await createIndexedProject();
    const result = await sampleProject(projectRoot, { limit: 2 });

    expect(result.count).toBe(2);
    expect(result.symbols).toHaveLength(2);
  });
});

async function createIndexedProject(): Promise<string> {
  const projectRoot = await createTempProject();

  await writeLuaFile(
    projectRoot,
    "src/player.lua",
    'Player = class("Player")\nfunction Player:move()\nend\nfunction spawnPlayer()\nend\nlocal function buildLocal()\nend\n',
  );
  await initializeProject(projectRoot);
  await indexProject(projectRoot);

  return projectRoot;
}

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "luagraph-sample-"));
  tempRoots.push(projectRoot);
  return projectRoot;
}

async function writeLuaFile(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const targetPath = join(projectRoot, relativePath);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
}
