import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { indexProject } from "../src/core/indexer.js";
import { initializeProject } from "../src/core/init.js";
import { queryProject } from "../src/core/query.js";

const tempRoots: string[] = [];

describe("queryProject", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("按 name 查询 Symbol", async () => {
    const projectRoot = await createIndexedProject();
    const result = await queryProject(projectRoot, "name:init");

    expect(result.count).toBe(1);
    expect(result.nodes[0]).toMatchObject({
      type: "Symbol",
      kind: "function",
      name: "init",
      qualifiedName: "init",
      filePath: "src/calls.lua",
    });
  });

  it("按 kind 查询 Symbol 和 File 统一模型", async () => {
    const projectRoot = await createIndexedProject();
    const functionResult = await queryProject(projectRoot, "kind:function");
    const fileResult = await queryProject(projectRoot, "kind:file");

    expect(functionResult.nodes.map((node) => node.kind)).toEqual(["function", "function", "function"]);
    expect(fileResult.nodes).toEqual([
      {
        type: "File",
        id: "src/calls.lua",
        kind: "file",
        name: "calls.lua",
        path: "src/calls.lua",
      },
    ]);
  });

  it("支持 kind 和 name 组合查询", async () => {
    const projectRoot = await createIndexedProject();
    const result = await queryProject(projectRoot, "kind:function name:init");

    expect(result.count).toBe(1);
    expect(result.nodes[0]).toMatchObject({ type: "Symbol", kind: "function", name: "init" });
  });

  it("查询 callers", async () => {
    const projectRoot = await createIndexedProject();
    const result = await queryProject(projectRoot, "callers:init");

    expect(result.nodes.map((node) => (node.type === "Symbol" ? node.qualifiedName : node.path))).toEqual([
      "boot",
    ]);
    expect(result.edges).toEqual([
      expect.objectContaining({
        kind: "Calls",
        line: 14,
        column: 3,
        isResolved: true,
      }),
    ]);
    expect(result.edges[0]?.source).toContain("#function#boot#");
    expect(result.edges[0]?.target).toContain("#function#init#");
  });

  it("查询 callees", async () => {
    const projectRoot = await createIndexedProject();
    const result = await queryProject(projectRoot, "callees:init");

    expect(result.nodes.map((node) => (node.type === "Symbol" ? node.qualifiedName : node.path))).toEqual([
      "foo",
      "M.foo",
      "obj:foo",
    ]);
    const callEdges = result.edges.filter((edge) => edge.kind === "Calls");
    expect(callEdges.map((edge) => [edge.line, edge.column, edge.isResolved])).toEqual([
      [9, 3, true],
      [10, 3, true],
      [11, 3, true],
    ]);
  });

  it("查询 extends 和 subclasses", async () => {
    const projectRoot = await createTempProject();

    await writeLuaFile(
      projectRoot,
      "src/inherit.lua",
      [
        "Base = {}",
        "Child = setmetatable({}, { __index = Base })",
        "GrandChild = setmetatable({}, { __index = Child })",
      ].join("\n"),
    );
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    const parentResult = await queryProject(projectRoot, "extends:Child");
    const childResult = await queryProject(projectRoot, "subclasses:Child");

    expect(parentResult.nodes.map((node) => (node.type === "Symbol" ? node.qualifiedName : node.path))).toEqual([
      "Base",
    ]);
    expect(parentResult.edges).toEqual([
      expect.objectContaining({ kind: "Extends" }),
    ]);
    expect(childResult.nodes.map((node) => (node.type === "Symbol" ? node.qualifiedName : node.path))).toEqual([
      "GrandChild",
    ]);
    expect(childResult.edges[0]?.source).toContain("#class#GrandChild#");
    expect(childResult.edges[0]?.target).toContain("#class#Child#");
  });

  it("subclasses 返回 class(name, parent) 的多个子类", async () => {
    const projectRoot = await createTempProject();

    await writeLuaFile(
      projectRoot,
      "SlotsNew/delegate.lua",
      [
        "SlotsBaseDelegate = {}",
        "SlotsMarketDelegate = class('SlotsMarketDelegate', SlotsBaseDelegate)",
        "SlotsSystemDelegate = class('SlotsSystemDelegate', SlotsBaseDelegate)",
      ].join("\n"),
    );
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    const result = await queryProject(projectRoot, "subclasses:SlotsBaseDelegate");

    expect(result.nodes.map((node) => (node.type === "Symbol" ? node.qualifiedName : node.path))).toEqual([
      "SlotsMarketDelegate",
      "SlotsSystemDelegate",
    ]);
    expect(result.edges).toHaveLength(2);
  });

  it("查询 requires 和 dependents 文件依赖", async () => {
    const projectRoot = await createTempProject();
    await writeLuaFile(projectRoot, "src/main.lua", 'local utils = require("utils")\n');
    await writeLuaFile(projectRoot, "src/utils.lua", "local M = {}\nreturn M\n");
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    const requiresResult = await queryProject(projectRoot, "requires:src/main.lua");
    const dependentsResult = await queryProject(projectRoot, "dependents:src/utils.lua");

    expect(requiresResult.nodes).toEqual([
      {
        type: "File",
        id: "src/utils.lua",
        kind: "file",
        name: "utils.lua",
        path: "src/utils.lua",
      },
    ]);
    expect(requiresResult.edges).toEqual([
      {
        kind: "Requires",
        source: "src/main.lua",
        target: "src/utils.lua",
        moduleName: "utils",
        isResolved: true,
      },
    ]);
    expect(dependentsResult.nodes).toEqual([
      {
        type: "File",
        id: "src/main.lua",
        kind: "file",
        name: "main.lua",
        path: "src/main.lua",
      },
    ]);
    expect(JSON.parse(JSON.stringify(dependentsResult))).toMatchObject({
      expression: "dependents:src/utils.lua",
      count: 1,
      edges: [{ kind: "Requires", source: "src/main.lua", target: "src/utils.lua" }],
    });
  });

  it("requires 和 dependents 支持路径片段匹配", async () => {
    const projectRoot = await createTempProject();
    await writeLuaFile(projectRoot, "SlotsNew/feature/ThemeExpandSymbolFeature.lua", "require 'SlotsNew.feature.ThemeFeatureBase'\n");
    await writeLuaFile(projectRoot, "SlotsNew/feature/ThemeCollectSymbolFeature.lua", "require 'SlotsNew.feature.ThemeFeatureBase'\n");
    await writeLuaFile(projectRoot, "SlotsNew/feature/ThemeFeatureBase.lua", "ThemeFeatureBase = {}\n");
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    const requiresResult = await queryProject(projectRoot, "requires:ThemeExpandSymbolFeature");
    const dependentsResult = await queryProject(projectRoot, "dependents:FeatureBase");

    expect(requiresResult.nodes.map((node) => (node.type === "File" ? node.path : node.filePath))).toEqual([
      "SlotsNew/feature/ThemeFeatureBase.lua",
    ]);
    expect(dependentsResult.nodes.map((node) => (node.type === "File" ? node.path : node.filePath))).toEqual([
      "SlotsNew/feature/ThemeCollectSymbolFeature.lua",
      "SlotsNew/feature/ThemeExpandSymbolFeature.lua",
    ]);
    expect(dependentsResult.edges).toHaveLength(2);
  });

  it("requires 和 dependents 兼容 ./ 和绝对路径查询", async () => {
    const projectRoot = await createTempProject();
    await writeLuaFile(projectRoot, "Systems/ThemeMain.lua", 'require("ThemeFeatureBase")\n');
    await writeLuaFile(projectRoot, "Systems/ThemeFeatureBase.lua", "ThemeFeatureBase = {}\n");
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    const dotSlashResult = await queryProject(projectRoot, "requires:./Systems/ThemeMain.lua");
    const absolutePathResult = await queryProject(
      projectRoot,
      `dependents:${join(projectRoot, "Systems/ThemeFeatureBase.lua")}`,
    );

    expect(dotSlashResult.edges).toEqual([
      expect.objectContaining({
        source: "Systems/ThemeMain.lua",
        target: "Systems/ThemeFeatureBase.lua",
      }),
    ]);
    expect(absolutePathResult.edges).toEqual([
      expect.objectContaining({
        source: "Systems/ThemeMain.lua",
        target: "Systems/ThemeFeatureBase.lua",
      }),
    ]);
  });
});

async function createIndexedProject(): Promise<string> {
  const projectRoot = await createTempProject();

  await writeLuaFile(
    projectRoot,
    "src/calls.lua",
    [
      "function foo()",
      "end",
      "M = {}",
      "function M.foo()",
      "end",
      "function obj:foo()",
      "end",
      "function init()",
      "  foo()",
      "  M.foo()",
      "  obj:foo()",
      "end",
      "function boot()",
      "  init()",
      "end",
    ].join("\n"),
  );
  await initializeProject(projectRoot);
  await indexProject(projectRoot);

  return projectRoot;
}

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "luagraph-query-"));
  tempRoots.push(projectRoot);
  return projectRoot;
}

async function writeLuaFile(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const targetPath = join(projectRoot, relativePath);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
}
