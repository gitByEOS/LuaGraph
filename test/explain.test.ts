import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { explainProject } from "../src/core/explain.js";
import { indexProject } from "../src/core/indexer.js";
import { initializeProject } from "../src/core/init.js";

const tempRoots: string[] = [];

describe("explainProject", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("按文件片段生成入口、分支、依赖和数据流摘要", async () => {
    const projectRoot = await createLuaProject();
    const result = await explainProject(projectRoot, "main.lua", { depth: 2 });

    expect(JSON.parse(JSON.stringify(result))).toMatchObject({
      input: "main.lua",
      depth: 2,
      target: {
        type: "file",
        name: "main.lua",
        filePath: "src/main.lua",
      },
    });
    expect(result.entrypoints.map((entrypoint) => entrypoint.qualifiedName)).toContain("boot");
    expect(result.flow.find((item) => item.entrypoint === "boot")?.calls[0]).toMatchObject({
      from: "boot",
      to: "helper",
      filePath: "src/utils.lua",
    });
    expect(result.branches).toEqual([
      expect.objectContaining({
        functionName: "boot",
        kind: "if",
        condition: "flag",
        line: 4,
      }),
    ]);
    expect(result.dependencies).toEqual([
      {
        moduleName: "missing",
        source: "src/main.lua",
        target: "src/main.lua",
        isResolved: false,
      },
      {
        moduleName: "utils",
        source: "src/main.lua",
        target: "src/utils.lua",
        isResolved: true,
      },
    ]);
    expect(result.dataFlow.map((step) => step.source)).toEqual([
      "input",
      "entrypoint",
      "callee",
      "return",
    ]);
    expect(result.externalGaps).toEqual([
      "外部依赖需查看: utils -> src/utils.lua",
      "外部函数需查看: helper -> src/utils.lua",
      "未解析 require/import: missing",
    ]);
  });

  it("按 symbol 聚焦所在文件和目标调用树", async () => {
    const projectRoot = await createLuaProject();
    const result = await explainProject(projectRoot, "boot", { depth: 1 });

    expect(result.target).toMatchObject({
      type: "symbol",
      name: "boot",
      filePath: "src/main.lua",
      startLine: 3,
    });
    expect(result.entrypoints[0]?.qualifiedName).toBe("boot");
    expect(result.flow[0]?.calls.map((call) => call.to)).toEqual(["helper"]);
  });

  it("识别 JS/TS 分支和 import 缺口", async () => {
    const projectRoot = await createTempProject();
    await writeSource(
      projectRoot,
      "src/main.ts",
      [
        "import { helper } from './utils';",
        "import { missing } from './missing';",
        "export function boot(flag: boolean) {",
        "  if (flag) {",
        "    return helper();",
        "  }",
        "  return flag ? missing() : 0;",
        "}",
      ].join("\n"),
    );
    await writeSource(projectRoot, "src/utils.ts", "export function helper() { return 1; }\n");
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    const result = await explainProject(projectRoot, "boot");

    expect(result.branches).toEqual([
      expect.objectContaining({
        functionName: "boot",
        kind: "if",
        condition: "flag",
        line: 4,
      }),
      expect.objectContaining({
        functionName: "boot",
        kind: "conditional",
        condition: "flag",
        line: 7,
      }),
    ]);
    expect(result.dependencies).toEqual([
      expect.objectContaining({ moduleName: "./missing", isResolved: false }),
      expect.objectContaining({ moduleName: "./utils", target: "src/utils.ts", isResolved: true }),
    ]);
    expect(result.externalGaps).toContain("未解析 require/import: ./missing");
  });

  it("JS/TS 文件入口保留低入度函数", async () => {
    const projectRoot = await createTempProject();
    await writeSource(
      projectRoot,
      "src/main.ts",
      [
        "export function boot() {",
        "  return internal();",
        "}",
        "function internal() {",
        "  return 1;",
        "}",
      ].join("\n"),
    );
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    const result = await explainProject(projectRoot, "src/main.ts");

    expect(result.entrypoints.map((entrypoint) => entrypoint.qualifiedName)).toEqual(["boot", "internal"]);
  });

  it("Lua method 不因非 local 自动成为文件入口", async () => {
    const projectRoot = await createTempProject();
    await writeSource(
      projectRoot,
      "src/control.lua",
      [
        'SlotsControl = class("SlotsControl")',
        "function SlotsControl:isActive()",
        "  return true",
        "end",
        "function SlotsControl:getInstance()",
        "  return self",
        "end",
      ].join("\n"),
    );
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    const fileResult = await explainProject(projectRoot, "src/control.lua");
    const symbolResult = await explainProject(projectRoot, "SlotsControl:isActive");

    expect(fileResult.entrypoints.map((entrypoint) => entrypoint.qualifiedName)).toEqual([]);
    expect(symbolResult.entrypoints.map((entrypoint) => entrypoint.qualifiedName)).toEqual([
      "SlotsControl:isActive",
    ]);
  });

  it("Lua self 方法调用按所在 class 建 Calls 边", async () => {
    const projectRoot = await createTempProject();
    await writeSource(
      projectRoot,
      "src/control.lua",
      [
        'SlotsControl = class("SlotsControl")',
        'OtherControl = class("OtherControl")',
        "function SlotsControl:ctor()",
        "  self:_initData()",
        "end",
        "function SlotsControl:_initData()",
        "  return 1",
        "end",
        "function OtherControl:ctor()",
        "  self:_initData()",
        "end",
        "function OtherControl:_initData()",
        "  return 2",
        "end",
      ].join("\n"),
    );
    await initializeProject(projectRoot);
    await indexProject(projectRoot);

    const fileResult = await explainProject(projectRoot, "src/control.lua", { depth: 1 });
    const classResult = await explainProject(projectRoot, "SlotsControl", { depth: 1 });
    const slotsResult = await explainProject(projectRoot, "SlotsControl:ctor", { depth: 1 });
    const otherResult = await explainProject(projectRoot, "OtherControl:ctor", { depth: 1 });

    expect(fileResult.entrypoints.map((entrypoint) => entrypoint.qualifiedName)).toEqual([
      "SlotsControl:ctor",
      "OtherControl:ctor",
    ]);
    expect(classResult.entrypoints.map((entrypoint) => entrypoint.qualifiedName)).toEqual([
      "SlotsControl:ctor",
    ]);
    expect(slotsResult.flow.find((item) => item.entrypoint === "SlotsControl:ctor")?.calls).toEqual([
      expect.objectContaining({
        from: "SlotsControl:ctor",
        to: "SlotsControl:_initData",
      }),
    ]);
    expect(otherResult.flow.find((item) => item.entrypoint === "OtherControl:ctor")?.calls).toEqual([
      expect.objectContaining({
        from: "OtherControl:ctor",
        to: "OtherControl:_initData",
      }),
    ]);
  });
});

async function createLuaProject(): Promise<string> {
  const projectRoot = await createTempProject();

  await writeSource(
    projectRoot,
    "src/main.lua",
    [
      'local utils = require("utils")',
      'local missing = require("missing")',
      "function boot(flag)",
      "  if flag then",
      "    return helper()",
      "  end",
      "  return flag",
      "end",
    ].join("\n"),
  );
  await writeSource(projectRoot, "src/utils.lua", "function helper()\n  return 1\nend\n");
  await initializeProject(projectRoot);
  await indexProject(projectRoot);

  return projectRoot;
}

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "luagraph-explain-"));
  tempRoots.push(projectRoot);
  return projectRoot;
}

async function writeSource(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const targetPath = join(projectRoot, relativePath);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${content}\n`, "utf8");
}
