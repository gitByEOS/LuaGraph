import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCli } from "../src/cli.js";
import { indexProject } from "../src/indexer.js";
import { initializeProject } from "../src/init.js";

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
      parseErrorCount: 0,
      symbolKindCounts: {},
      pendingSyncChangeCount: 0,
      configPath: join(projectRoot, ".luagraph/config.json"),
      databaseDir: join(projectRoot, ".luagraph/kuzu"),
      schemaCount: 8,
    });

    log.mockRestore();
  });

  it("无参数时默认使用当前目录", async () => {
    const projectRoot = await createTempProject();
    const previousCwd = process.cwd();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const cli = createTestCli();

    try {
      await cli.parseAsync(["node", "luagraph", "init", projectRoot], { from: "node" });
      log.mockClear();
      process.chdir(projectRoot);
      const resolvedProjectRoot = await realpath(projectRoot);

      await cli.parseAsync(["node", "luagraph", "status"], { from: "node" });

      expect(log).toHaveBeenCalledTimes(1);
      const output = log.mock.calls[0]?.[0];
      expect(typeof output).toBe("string");
      expect(JSON.parse(output as string)).toMatchObject({
        fileCount: 0,
        symbolCount: 0,
        edgeCount: 0,
        parseErrorCount: 0,
        symbolKindCounts: {},
        pendingSyncChangeCount: 0,
        configPath: join(resolvedProjectRoot, ".luagraph/config.json"),
        databaseDir: join(resolvedProjectRoot, ".luagraph/kuzu"),
        schemaCount: 8,
      });
    } finally {
      process.chdir(previousCwd);
      log.mockRestore();
    }
  });
});

describe("luagraph index CLI", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("index 命令完成写入并输出 JSON", async () => {
    const projectRoot = await createTempProject();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cli = createTestCli();

    await writeLuaFile(
      projectRoot,
      "src/player.lua",
      'Player = class("Player")\nfunction Player:move()\nend\n',
    );

    await cli.parseAsync(["node", "luagraph", "init", projectRoot], { from: "node" });
    log.mockClear();

    await cli.parseAsync(["node", "luagraph", "index", projectRoot, "--format", "json"], {
      from: "node",
    });

    expect(log).toHaveBeenCalledTimes(1);
    const output = log.mock.calls[0]?.[0];
    expect(typeof output).toBe("string");
    expect(JSON.parse(output as string)).toMatchObject({
      fileCount: 1,
      symbolCount: 2,
      containsCount: 2,
      databaseDir: join(projectRoot, ".luagraph/kuzu"),
    });
    expect(error.mock.calls.map((call) => String(call[0]))).toEqual(
      expect.arrayContaining([
        "[index] 开始扫描 Lua 文件",
        "[index] 扫描到 1 个 Lua 文件",
        "[index] 开始索引 Lua 符号",
        "[index] 索引文件[1/1] player.lua ...",
        "[index] 完成统计：文件 1，符号 2，Contains 2，Calls 0",
      ]),
    );

    log.mockRestore();
    error.mockRestore();
  });

  it("不再暴露 analyze 命令", async () => {
    const cli = createTestCli();
    const helpText = cli.helpInformation();

    expect(helpText).toContain("index");
    expect(helpText).not.toContain("analyze");
    await expect(cli.parseAsync(["node", "luagraph", "analyze"], { from: "node" })).rejects.toThrow(
      "unknown command 'analyze'",
    );
  });
});

describe("luagraph sync CLI", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("sync 命令输出可解析 JSON", async () => {
    const projectRoot = await createTempProject();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const cli = createTestCli();

    await writeLuaFile(projectRoot, "src/player.lua", "function before()\nend\n");
    await initializeProject(projectRoot);
    await indexProject(projectRoot);
    await writeLuaFile(projectRoot, "src/player.lua", "function after()\nend\n");

    await cli.parseAsync(["node", "luagraph", "sync", projectRoot, "--format", "json"], {
      from: "node",
    });

    expect(log).toHaveBeenCalledTimes(1);
    const output = log.mock.calls[0]?.[0];
    expect(typeof output).toBe("string");
    expect(JSON.parse(output as string)).toMatchObject({
      scannedFileCount: 1,
      changedFileCount: 1,
      removedFileCount: 0,
      symbolCount: 1,
      containsCount: 1,
      databaseDir: join(projectRoot, ".luagraph/kuzu"),
    });

    log.mockRestore();
  });
});

describe("luagraph query CLI", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("输出机器可解析 JSON", async () => {
    const projectRoot = await createTempProject();
    const previousCwd = process.cwd();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const cli = createTestCli();

    try {
      await writeLuaFile(projectRoot, "src/main.lua", "function init()\nend\n");
      await initializeProject(projectRoot);
      await indexProject(projectRoot);
      process.chdir(projectRoot);

      await cli.parseAsync(["node", "luagraph", "query", "name:init", "--format", "json"], {
        from: "node",
      });

      expect(log).toHaveBeenCalledTimes(1);
      const output = log.mock.calls[0]?.[0];
      expect(typeof output).toBe("string");
      expect(JSON.parse(output as string)).toMatchObject({
        expression: "name:init",
        count: 1,
        nodes: [
          {
            type: "Symbol",
            kind: "function",
            name: "init",
            qualifiedName: "init",
          },
        ],
      });
    } finally {
      process.chdir(previousCwd);
      log.mockRestore();
    }
  });
});

describe("luagraph sample CLI", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("无参数时默认使用当前目录", async () => {
    const projectRoot = await createTempProject();
    const previousCwd = process.cwd();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const cli = createTestCli();

    try {
      await writeLuaFile(projectRoot, "src/player.lua", "function spawnPlayer()\nend\n");
      await initializeProject(projectRoot);
      await indexProject(projectRoot);
      process.chdir(projectRoot);

      await cli.parseAsync(["node", "luagraph", "sample", "--limit", "1"], { from: "node" });

      expect(log).toHaveBeenCalledTimes(1);
      const output = log.mock.calls[0]?.[0];
      expect(typeof output).toBe("string");
      expect(JSON.parse(output as string)).toMatchObject({
        projectRoot: await realpath(projectRoot),
        count: 1,
        symbols: [
          {
            kind: "function",
            name: "spawnPlayer",
            qualifiedName: "spawnPlayer",
            filePath: "src/player.lua",
            startLine: 1,
            isLocal: false,
            signature: "function spawnPlayer()",
          },
        ],
      });
    } finally {
      process.chdir(previousCwd);
      log.mockRestore();
    }
  });

  it("help 包含 sample 命令", () => {
    const cli = createTestCli();
    const helpText = cli.helpInformation();

    expect(helpText).toContain("sample");
  });
});

describe("luagraph serve CLI", () => {
  it("help 包含 serve 命令", () => {
    const cli = createTestCli();
    const helpText = cli.helpInformation();

    expect(helpText).toContain("serve");
  });

  it("拒绝非法端口", async () => {
    const cli = createTestCli();

    await expect(
      cli.parseAsync(["node", "luagraph", "serve", "--port", "abc"], { from: "node" }),
    ).rejects.toThrow("serve --port 必须是 0 到 65535 的整数");
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

async function writeLuaFile(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const targetPath = join(projectRoot, relativePath);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
}
