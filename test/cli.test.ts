import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Command } from "commander";
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
        "[index] 完成统计：文件 1，符号 2，Contains 2，Calls 0，Extends 0，Requires 0",
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
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
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
    expect(error.mock.calls.map((call) => String(call[0]))).toEqual(
      expect.arrayContaining([
        "[sync] 开始扫描 Lua 文件",
        "[sync] 扫描到 1 个 Lua 文件",
        "[sync] 开始对比 contentHash",
        "[sync] 待刷新 1 个文件，待删除 0 个文件",
        "[sync] 同步文件[1/1] player.lua",
        "[sync] 开始重建 Calls",
        "[sync] 开始重建 Extends",
        "[sync] 开始重建 Requires",
        "[sync] 完成统计：扫描 1，刷新 1，删除 0，符号 1，Contains 1，Calls 0，Extends 0，Requires 0",
      ]),
    );

    log.mockRestore();
    error.mockRestore();
  });

  it("sync --quiet 不输出结果和进度", async () => {
    const projectRoot = await createTempProject();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cli = createTestCli();

    await writeLuaFile(projectRoot, "src/player.lua", "function before()\nend\n");
    await initializeProject(projectRoot);
    await indexProject(projectRoot);
    await writeLuaFile(projectRoot, "src/player.lua", "function after()\nend\n");

    await cli.parseAsync(["node", "luagraph", "sync", projectRoot, "--quiet"], {
      from: "node",
    });

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    log.mockRestore();
    error.mockRestore();
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

  it("help 清楚说明表达式、格式和示例", () => {
    const cli = createTestCli();
    const query = getCommand(cli, "query");
    const helpText = query.helpInformation();

    expect(helpText).toContain("name:<symbol>");
    expect(helpText).toContain("kind:<kind>");
    expect(helpText).toContain("callers:<symbol>");
    expect(helpText).toContain("callees:<symbol>");
    expect(helpText).toContain("requires:<file>");
    expect(helpText).toContain("dependents:<file>");
    expect(helpText).toContain("输出格式：json、table 或 tree");
    expect(helpText).toContain("luagraph query callers:ThemeCollectDialog --depth 2 --format tree");
  });
});

describe("luagraph help 文案规范", () => {
  it("常用命令说明参数范围和示例", () => {
    const cli = createTestCli();

    expect(getCommand(cli, "impact").helpInformation()).toContain("反向调用影响范围");
    expect(getCommand(cli, "impact").helpInformation()).toContain("luagraph impact ThemeCollectDialog --format table");
    expect(getCommand(cli, "index").helpInformation()).toContain("输出格式：json 或 table");
    expect(getCommand(cli, "index").helpInformation()).toContain("luagraph index /path/to/lua-project --force --format json");
    expect(getCommand(cli, "sync").helpInformation()).toContain("进度写入 stderr");
    expect(getCommand(cli, "sync").helpInformation()).toContain("luagraph sync /path/to/lua-project --format table");
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

function getCommand(cli: ReturnType<typeof createCli>, name: string): Command {
  const command = cli.commands.find((item) => item.name() === name);

  if (command === undefined) {
    throw new Error(`命令不存在: ${name}`);
  }

  return command;
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
