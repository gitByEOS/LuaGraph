import { describe, expect, it } from "vitest";

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach } from "vitest";

import { indexProject } from "../src/indexer.js";
import { getProjectStatus } from "../src/status.js";
import { initializeProject } from "../src/init.js";

const tempRoots: string[] = [];

describe("index verification", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("index 后 status 输出非零计数", async () => {
    const projectRoot = await createTempProject();

    await writeLuaFile(
      projectRoot,
      "Systems/Player.lua",
      'Player = class("Player")\nfunction Player:attack()\nend\n',
    );

    await initializeProject(projectRoot);

    const indexResult = await indexProject(projectRoot);

    expect(indexResult.fileCount).toBe(1);
    expect(indexResult.symbolCount).toBeGreaterThan(0);
    expect(indexResult.containsCount).toBeGreaterThan(0);

    const statusResult = await getProjectStatus(projectRoot);

    expect(statusResult.fileCount).toBe(1);
    expect(statusResult.symbolCount).toBe(indexResult.symbolCount);
    expect(statusResult.edgeCount).toBeGreaterThan(0);
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "luagraph-verify-"));
  tempRoots.push(projectRoot);
  return projectRoot;
}

async function writeLuaFile(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const targetPath = join(projectRoot, relativePath);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
}
