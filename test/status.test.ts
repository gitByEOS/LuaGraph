import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeProject } from "../src/init.js";
import { getProjectStatus } from "../src/status.js";

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
      databaseDir: join(projectRoot, ".luagraph/kuzu"),
      configPath: join(projectRoot, ".luagraph/config.json"),
      schemaCount: 8,
    });
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "luagraph-status-"));
  tempRoots.push(projectRoot);
  return projectRoot;
}
