import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { indexProject } from "../src/indexer.js";
import { initializeProject } from "../src/init.js";
import { queryProject } from "../src/query.js";

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
    expect(result.edges.map((edge) => [edge.line, edge.column, edge.isResolved])).toEqual([
      [9, 3, true],
      [10, 3, true],
      [11, 3, true],
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
