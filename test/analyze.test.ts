import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { analyzeProject } from "../src/analyze.js";
import { initializeProject } from "../src/init.js";

const tempRoots: string[] = [];

describe("analyzeProject", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("解析 Systems/ 全部 Lua 文件并写入 Kuzu", async () => {
    const projectRoot = "/Users/bole/dev/mul-agents/LuaGraph";

    await initializeProject(projectRoot);

    const result = await analyzeProject(projectRoot, "Systems/**/*.lua");

    expect(result.fileCount).toBe(18);
    expect(result.symbolCount).toBeGreaterThan(0);
    expect(result.containsCount).toBe(result.symbolCount);
  }, 60000);

  it("对空项目返回零计数", async () => {
    const projectRoot = await createTempProject();

    await initializeProject(projectRoot);

    await expect(analyzeProject(projectRoot, "src/**/*.lua")).resolves.toEqual({
      fileCount: 0,
      symbolCount: 0,
      containsCount: 0,
      databaseDir: join(projectRoot, ".luagraph/kuzu"),
    });
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "luagraph-analyze-"));
  tempRoots.push(projectRoot);
  return projectRoot;
}
