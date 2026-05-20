import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCli } from "../src/cli.js";

const tempRoots: string[] = [];

describe("luagraph init CLI", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("缺少项目路径时提示用法", async () => {
    const cli = createTestCli();

    await expect(cli.parseAsync(["node", "luagraph", "init"], { from: "node" })).rejects.toThrow(
      "请指定项目路径：luagraph init <project_root>",
    );
  });

  it("指定项目路径时输出初始化结果", async () => {
    const projectRoot = await createTempProject();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const cli = createTestCli();

    await cli.parseAsync(["node", "luagraph", "init", projectRoot], { from: "node" });

    expect(log).toHaveBeenCalledTimes(1);
    const output = log.mock.calls[0]?.[0];
    expect(typeof output).toBe("string");
    expect(JSON.parse(output as string)).toMatchObject({
      projectRoot,
      configPath: join(projectRoot, ".luagraph/config.json"),
      databaseDir: join(projectRoot, ".luagraph/kuzu"),
      schemaCount: 8,
    });

    log.mockRestore();
  });
});

describe("luagraph status CLI", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("缺少项目路径时提示用法", async () => {
    const cli = createTestCli();

    await expect(cli.parseAsync(["node", "luagraph", "status"], { from: "node" })).rejects.toThrow(
      "请指定项目路径：luagraph status <project_root> 或 luagraph status --project-root <path>",
    );
  });

  it("支持 --project-root 输出状态结果", async () => {
    const projectRoot = await createTempProject();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const cli = createTestCli();

    await cli.parseAsync(["node", "luagraph", "init", projectRoot], { from: "node" });
    log.mockClear();
    await cli.parseAsync(["node", "luagraph", "status", "--project-root", projectRoot], {
      from: "node",
    });

    expect(log).toHaveBeenCalledTimes(1);
    const output = log.mock.calls[0]?.[0];
    expect(typeof output).toBe("string");
    expect(JSON.parse(output as string)).toMatchObject({
      fileCount: 0,
      symbolCount: 0,
      edgeCount: 0,
      configPath: join(projectRoot, ".luagraph/config.json"),
      databaseDir: join(projectRoot, ".luagraph/kuzu"),
      schemaCount: 8,
    });

    log.mockRestore();
  });
});

function createTestCli() {
  return createCli().exitOverride();
}

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "luagraph-cli-"));
  tempRoots.push(projectRoot);
  return projectRoot;
}
