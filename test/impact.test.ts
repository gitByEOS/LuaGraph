import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { impactProject } from "../src/impact.js";
import { indexProject } from "../src/indexer.js";
import { initializeProject } from "../src/init.js";

const tempRoots: string[] = [];

describe("impactProject", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("按符号名分析默认两层影响", async () => {
    const projectRoot = await createIndexedProject();
    const result = await impactProject(projectRoot, "leaf");

    expect(result.depth).toBe(2);
    expect(result.seeds.map((seed) => seed.qualifiedName)).toEqual(["leaf"]);
    expect(result.nodes.map((node) => node.qualifiedName)).toEqual(["middle", "appBoot"]);
    expect(result.files).toEqual(["src/api.lua", "src/app.lua"]);
  });

  it("按文件路径定位文件内 Symbol 后分析反向 callers", async () => {
    const projectRoot = await createIndexedProject();
    const result = await impactProject(projectRoot, "src/api.lua", { depth: 2 });

    expect(result.seeds.map((seed) => seed.qualifiedName)).toEqual([
      "leaf",
      "middle",
      "cycleA",
      "cycleB",
    ]);
    expect(result.nodes.map((node) => node.qualifiedName)).toEqual(["appBoot", "root"]);
    expect(result.files).toEqual(["src/app.lua", "src/root.lua"]);
  });

  it("尊重 depth 限制", async () => {
    const projectRoot = await createIndexedProject();
    const result = await impactProject(projectRoot, "leaf", { depth: 1 });

    expect(result.nodes.map((node) => node.qualifiedName)).toEqual(["middle"]);
    expect(result.edges).toHaveLength(1);
  });

  it("遇到调用环时不重复回到已访问 Symbol", async () => {
    const projectRoot = await createIndexedProject();
    const result = await impactProject(projectRoot, "cycleA", { depth: 3 });

    expect(result.seeds.map((seed) => seed.qualifiedName)).toEqual(["cycleA"]);
    expect(result.nodes.map((node) => node.qualifiedName)).toEqual(["cycleB"]);
    expect(result.edges.map((edge) => [edge.source, edge.target])).toHaveLength(1);
  });

  it("同文件 Player.new 构造调用连到 class Player", async () => {
    const projectRoot = await createTempProject();
    await writeLuaFile(
      projectRoot,
      "src/player.lua",
      [
        'Player = class("Player")',
        "function createPlayer()",
        "  return Player.new()",
        "end",
      ].join("\n"),
    );
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    const result = await impactProject(projectRoot, "Player");

    expect(result.seeds.map((seed) => seed.qualifiedName)).toEqual(["Player"]);
    expect(result.nodes.map((node) => node.qualifiedName)).toEqual(["createPlayer"]);
    expect(result.edges).toHaveLength(1);
  });

  it("跨文件唯一 class 可接收 X.new 构造调用", async () => {
    const projectRoot = await createTempProject();
    await writeLuaFile(projectRoot, "src/player.lua", 'Player = class("Player")');
    await writeLuaFile(
      projectRoot,
      "src/factory.lua",
      ["function createPlayer()", "  return Player.new()", "end"].join("\n"),
    );
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    const result = await impactProject(projectRoot, "Player");

    expect(result.nodes.map((node) => node.qualifiedName)).toEqual(["createPlayer"]);
    expect(result.edges).toHaveLength(1);
  });

  it("跨文件同名 class 且调用文件没有本地 class 时不连边", async () => {
    const projectRoot = await createTempProject();
    await writeLuaFile(projectRoot, "src/skin/player.lua", 'Player = class("Player")');
    await writeLuaFile(projectRoot, "src/game/player.lua", 'Player = class("Player")');
    await writeLuaFile(
      projectRoot,
      "src/factory.lua",
      ["function createPlayer()", "  return Player.new()", "end"].join("\n"),
    );
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    const result = await impactProject(projectRoot, "Player");

    expect(result.seeds.map((seed) => seed.qualifiedName)).toEqual(["Player", "Player"]);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("Systems 风格同名 class 优先连接同文件构造调用", async () => {
    const projectRoot = await createTempProject();
    await writeLuaFile(
      projectRoot,
      "src/first/theme_collect_dialog.lua",
      [
        'ThemeCollectDialog = class("ThemeCollectDialog" , CCSNode)',
        "function createFirstDialog()",
        "  local dialog = ThemeCollectDialog.new(self.ctl, callback)",
        "  return dialog",
        "end",
      ].join("\n"),
    );
    await writeLuaFile(
      projectRoot,
      "src/second/theme_collect_dialog.lua",
      [
        'ThemeCollectDialog = class("ThemeCollectDialog" , CCSNode)',
        "function createSecondDialog()",
        "  local dialog = ThemeCollectDialog.new(self.ctl, callback)",
        "  return dialog",
        "end",
      ].join("\n"),
    );
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    const result = await impactProject(projectRoot, "ThemeCollectDialog");

    expect(result.seeds.map((seed) => seed.qualifiedName)).toEqual([
      "ThemeCollectDialog",
      "ThemeCollectDialog",
    ]);
    expect(result.nodes.map((node) => node.qualifiedName)).toEqual([
      "createFirstDialog",
      "createSecondDialog",
    ]);
    expect(result.edges).toHaveLength(2);
  });

  it("文件影响分析包含反向 Requires 依赖文件", async () => {
    const projectRoot = await createTempProject();
    await writeLuaFile(projectRoot, "src/main.lua", 'local utils = require("utils")');
    await writeLuaFile(projectRoot, "src/feature.lua", 'local utils = require("utils")');
    await writeLuaFile(projectRoot, "src/utils.lua", "function helper()\nend");
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    const result = await impactProject(projectRoot, "src/utils.lua");

    expect(result.files).toEqual(["src/feature.lua", "src/main.lua"]);
    expect(result.edges).toEqual([
      {
        kind: "Requires",
        source: "src/feature.lua",
        target: "src/utils.lua",
        moduleName: "utils",
        isResolved: true,
      },
      {
        kind: "Requires",
        source: "src/main.lua",
        target: "src/utils.lua",
        moduleName: "utils",
        isResolved: true,
      },
    ]);
  });
});

async function createIndexedProject(): Promise<string> {
  const projectRoot = await createTempProject();

  await writeLuaFile(
    projectRoot,
    "src/api.lua",
    [
      "function leaf()",
      "end",
      "function middle()",
      "  leaf()",
      "end",
      "function cycleA()",
      "  cycleB()",
      "end",
      "function cycleB()",
      "  cycleA()",
      "end",
    ].join("\n"),
  );
  await writeLuaFile(
    projectRoot,
    "src/app.lua",
    ["function appBoot()", "  middle()", "end"].join("\n"),
  );
  await writeLuaFile(
    projectRoot,
    "src/root.lua",
    ["function root()", "  appBoot()", "end"].join("\n"),
  );
  await initializeProject(projectRoot);
  await indexProject(projectRoot);

  return projectRoot;
}

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "luagraph-impact-"));
  tempRoots.push(projectRoot);
  return projectRoot;
}

async function writeLuaFile(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const targetPath = join(projectRoot, relativePath);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${content}\n`, "utf8");
}
