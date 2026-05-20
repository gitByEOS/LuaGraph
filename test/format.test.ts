import { describe, expect, it } from "vitest";

import { formatImpactResult, formatQueryResult } from "../src/format.js";
import type { LuaGraphImpactResult, LuaGraphQueryResult } from "../src/types.js";

describe("graph output formatters", () => {
  it("query json 输出保持可解析", () => {
    const output = formatQueryResult(createQueryResult(), "json");

    expect(JSON.parse(output)).toMatchObject({ expression: "callers:leaf", count: 2 });
  });

  it("query table 输出适合终端阅读", () => {
    expect(formatQueryResult(createQueryResult(), "table")).toBe(
      [
        "expression\tcallers:leaf",
        "count\t2",
        "type\tkind\tpath/filePath\tline\tqualifiedName\tsignature",
        "Symbol\tfunction\tsrc/api.lua\t3\tmiddle\tfunction middle()",
        "Symbol\tfunction\tsrc/app.lua\t1\tappBoot\tfunction appBoot()",
      ].join("\n"),
    );
  });

  it("query table 空结果保留表头", () => {
    const output = formatQueryResult({ ...createQueryResult(), count: 0, nodes: [], edges: [] }, "table");

    expect(output).toContain("expression\tcallers:leaf");
    expect(output).toContain("type\tkind\tpath/filePath\tline\tqualifiedName\tsignature");
  });

  it("query tree 按调用层级展示", () => {
    expect(formatQueryResult(createQueryResult(), "tree")).toBe(
      [
        "callers:leaf",
        "  src/api.lua:3 function middle function middle()",
        "    src/app.lua:1 function appBoot function appBoot()",
      ].join("\n"),
    );
  });

  it("impact json/table/tree 都稳定输出", () => {
    const result = createImpactResult();
    const tableOutput = formatImpactResult(result, "table");

    expect(JSON.parse(formatImpactResult(result, "json"))).toMatchObject({ input: "leaf", count: 2 });
    expect(tableOutput).toContain("input\tleaf");
    expect(tableOutput).toContain("seeds\ntype\tkind\tfilePath\tline\tqualifiedName\tsignature");
    expect(tableOutput).toContain("affected\ntype\tkind\tfilePath\tline\tqualifiedName\tsignature");
    expect(tableOutput).toContain("Symbol\tfunction\tsrc/api.lua\t3\tmiddle\tfunction middle()");
    expect(tableOutput).toContain("files\npath\nsrc/api.lua");
    expect(formatImpactResult(result, "tree")).toBe(
      [
        "impact:leaf depth=2",
        "  src/api.lua:1 function leaf function leaf()",
        "    src/api.lua:3 function middle function middle()",
        "      src/app.lua:1 function appBoot function appBoot()",
      ].join("\n"),
    );
  });

  it("impact table 空结果保留分段表头", () => {
    const output = formatImpactResult({ ...createImpactResult(), seeds: [], count: 0, nodes: [], files: [], edges: [] }, "table");

    expect(output).toContain("input\tleaf");
    expect(output).toContain("seeds\ntype\tkind\tfilePath\tline\tqualifiedName\tsignature");
    expect(output).toContain("affected\ntype\tkind\tfilePath\tline\tqualifiedName\tsignature");
    expect(output).toContain("files\npath");
  });
});

function createQueryResult(): LuaGraphQueryResult {
  const leaf = createSymbol("src/api.lua#function#leaf#1:1", "leaf", "src/api.lua", 1);
  const middle = createSymbol("src/api.lua#function#middle#3:1", "middle", "src/api.lua", 3);
  const appBoot = createSymbol("src/app.lua#function#appBoot#1:1", "appBoot", "src/app.lua", 1);

  return {
    projectRoot: "/tmp/project",
    expression: "callers:leaf",
    count: 2,
    nodes: [middle, appBoot],
    edges: [
      createEdge(appBoot.id, middle.id, 2),
      createEdge(middle.id, leaf.id, 4),
    ],
  };
}

function createImpactResult(): LuaGraphImpactResult {
  const leaf = createSymbol("src/api.lua#function#leaf#1:1", "leaf", "src/api.lua", 1);
  const middle = createSymbol("src/api.lua#function#middle#3:1", "middle", "src/api.lua", 3);
  const appBoot = createSymbol("src/app.lua#function#appBoot#1:1", "appBoot", "src/app.lua", 1);

  return {
    projectRoot: "/tmp/project",
    input: "leaf",
    depth: 2,
    seeds: [leaf],
    count: 2,
    nodes: [middle, appBoot],
    files: ["src/api.lua", "src/app.lua"],
    edges: [
      createEdge(middle.id, leaf.id, 4),
      createEdge(appBoot.id, middle.id, 2),
    ],
  };
}

function createSymbol(id: string, qualifiedName: string, filePath: string, startLine: number) {
  return {
    type: "Symbol" as const,
    id,
    kind: "function",
    name: qualifiedName,
    qualifiedName,
    filePath,
    startLine,
    signature: `function ${qualifiedName}()`,
  };
}

function createEdge(source: string, target: string, line: number) {
  return {
    kind: "Calls" as const,
    source,
    target,
    line,
    column: 3,
    isResolved: true,
  };
}
