import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeProject } from "../src/core/init.js";
import type { LuaGraphConfig } from "../src/core/project-types.js";

const tempRoots: string[] = [];

describe("initializeProject", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("正常初始化 .luagraph config 和 Kuzu store", async () => {
    const projectRoot = await createTempProject();

    const result = await initializeProject(projectRoot);

    expect(result).toEqual({
      projectRoot,
      configPath: join(projectRoot, ".luagraph/config.json"),
      databaseDir: join(projectRoot, ".luagraph/kuzu"),
      schemaCount: 8,
    });
    await expectDirectory(join(projectRoot, ".luagraph"));
    await expectDirectory(join(projectRoot, ".luagraph/kuzu"));
    await expect(readFile(join(projectRoot, ".luagraph/config.json"), "utf8")).resolves.toContain(
      '"databaseDir": ".luagraph/kuzu"',
    );
  });

  it("重复执行不覆盖已有合法 config", async () => {
    const projectRoot = await createTempProject();
    const config: LuaGraphConfig = {
      include: ["src/**/*.lua"],
      exclude: [".luagraph/**", "vendor/**"],
      databaseDir: ".custom/kuzu",
    };
    const configText = `${JSON.stringify(config)}\n`;

    await mkdir(join(projectRoot, ".luagraph"), { recursive: true });
    await writeFile(join(projectRoot, ".luagraph/config.json"), configText, "utf8");

    const result = await initializeProject(projectRoot);

    expect(result.databaseDir).toBe(join(projectRoot, ".custom/kuzu"));
    await expect(readFile(join(projectRoot, ".luagraph/config.json"), "utf8")).resolves.toBe(
      configText,
    );
    await expectDirectory(join(projectRoot, ".custom/kuzu"));
  });

  it("不存在目录时报清晰错误", async () => {
    const projectRoot = join(await createTempProject(), "missing");

    await expect(initializeProject(projectRoot)).rejects.toThrow(`项目路径不存在：${projectRoot}`);
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "luagraph-init-"));
  tempRoots.push(projectRoot);
  return projectRoot;
}

async function expectDirectory(path: string): Promise<void> {
  await expect(stat(path)).resolves.toSatisfy((stats) => stats.isDirectory());
}
