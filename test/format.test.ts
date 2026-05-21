import { describe, expect, it } from "vitest";

import { formatImpactResult, formatQueryResult } from "../src/cli/format.js";
import type { LuaGraphImpactResult, LuaGraphQueryResult } from "../src/core/project-types.js";

describe("graph output formatters", () => {
  it("query json 输出保持可解析", () => {
    const output = formatQueryResult(createQueryResult(), "json");

    expect(JSON.parse(output)).toMatchObject({ expression: "callers:leaf", count: 2 });
  });

  it("query table 输出适合终端阅读", () => {
    expect(formatQueryResult(createQueryResult(), "table")).toBe(
      [
        "+---------+----------+-------------+------+-----+",
        "| Caller  | Kind     | File        | Line | Col |",
        "+---------+----------+-------------+------+-----+",
        "| middle  | function | src/api.lua | 4    | 3   |",
        "| appBoot | function | src/app.lua | 2    | 3   |",
        "+---------+----------+-------------+------+-----+",
        "2 rows, target: leaf (src/api.lua:1)",
      ].join("\n"),
    );
  });

  it("query table 空结果保留表头", () => {
    const output = formatQueryResult({ ...createQueryResult(), count: 0, nodes: [], edges: [] }, "table");

    expect(output).toBe(
      [
        "+--------+------+------+------+-----+",
        "| Caller | Kind | File | Line | Col |",
        "+--------+------+------+------+-----+",
        "+--------+------+------+------+-----+",
        "0 rows, target: leaf",
      ].join("\n"),
    );
  });

  it("query tree 按调用层级展示", () => {
    expect(formatQueryResult(createQueryResult(), "tree")).toBe(
      [
        "leaf()  (src/api.lua:1)",
        "└── called by middle() [src/api.lua:4]",
        "    └── called by appBoot() [src/app.lua:2]",
      ].join("\n"),
    );
  });

  it("query tree 展示分叉和环路", () => {
    expect(formatQueryResult(createBranchCycleQueryResult(), "tree")).toBe(
      [
        "leaf()  (src/leaf.lua:1)",
        "├── called by cycleA() [src/cycle.lua:5]",
        "│   └── called by cycleB() [src/cycle.lua:9]",
        "│       └── called by cycleA() [src/cycle.lua:6] (cycle)",
        "└── called by sideDoor() [src/side.lua:2]",
      ].join("\n"),
    );
  });

  it("callees table 和 tree 使用 calls 文案", () => {
    expect(formatQueryResult(createCalleesResult(), "table")).toBe(
      [
        "+--------+----------+-------------+------+-----+",
        "| Callee | Kind     | File        | Line | Col |",
        "+--------+----------+-------------+------+-----+",
        "| leaf   | function | src/api.lua | 2    | 3   |",
        "+--------+----------+-------------+------+-----+",
        "1 rows, target: appBoot (src/app.lua:1)",
      ].join("\n"),
    );
    expect(formatQueryResult(createCalleesResult(), "tree")).toBe(
      ["appBoot()  (src/app.lua:1)", "└── calls leaf() [src/api.lua:2]"].join("\n"),
    );
  });

  it("extends table 和 tree 展示继承关系", () => {
    expect(formatQueryResult(createExtendsResult(), "table")).toBe(
      [
        "+--------+-------+--------------+------+-----------+",
        "| Parent | Kind  | File         | Line | Signature |",
        "+--------+-------+--------------+------+-----------+",
        "| Base   | table | src/base.lua | 1    | Base = {} |",
        "+--------+-------+--------------+------+-----------+",
        "1 rows, target: Child (src/child.lua:1)",
      ].join("\n"),
    );
    expect(formatQueryResult(createExtendsResult(), "tree")).toBe(
      ["Child()  (src/child.lua:1)", "└── extends Base [src/base.lua:1]"].join("\n"),
    );
  });

  it("普通 query table 使用通用 ASCII 表格", () => {
    expect(formatQueryResult(createNameQueryResult(), "table")).toBe(
      [
        "+------+----------+-------------+------+-----------------+",
        "| Name | Kind     | File        | Line | Signature       |",
        "+------+----------+-------------+------+-----------------+",
        "| leaf | function | src/api.lua | 1    | function leaf() |",
        "+------+----------+-------------+------+-----------------+",
        "1 rows, target: name:leaf",
      ].join("\n"),
    );
  });

  it("impact json/table/tree 都稳定输出", () => {
    const result = createImpactResult();

    expect(JSON.parse(formatImpactResult(result, "json"))).toMatchObject({ input: "leaf", count: 2 });
    expect(formatImpactResult(result, "table")).toBe(
      [
        "input: leaf",
        "depth: 2",
        "count: 2",
        "",
        "seeds",
        "+------+----------+-------------+------+-----------------+",
        "| Name | Kind     | File        | Line | Signature       |",
        "+------+----------+-------------+------+-----------------+",
        "| leaf | function | src/api.lua | 1    | function leaf() |",
        "+------+----------+-------------+------+-----------------+",
        "1 rows",
        "",
        "affected",
        "+---------+----------+-------------+------+--------------------+",
        "| Name    | Kind     | File        | Line | Signature          |",
        "+---------+----------+-------------+------+--------------------+",
        "| middle  | function | src/api.lua | 3    | function middle()  |",
        "| appBoot | function | src/app.lua | 1    | function appBoot() |",
        "+---------+----------+-------------+------+--------------------+",
        "2 rows",
        "",
        "files",
        "+-------------+",
        "| Path        |",
        "+-------------+",
        "| src/api.lua |",
        "| src/app.lua |",
        "+-------------+",
        "2 rows",
      ].join("\n"),
    );
    expect(formatImpactResult(result, "tree")).toBe(
      [
        "leaf()  (src/api.lua:1)",
        "└── called by middle() [src/api.lua:4]",
        "    └── called by appBoot() [src/app.lua:2]",
      ].join("\n"),
    );
  });

  it("impact table 空结果保留分段表头", () => {
    const output = formatImpactResult({ ...createImpactResult(), seeds: [], count: 0, nodes: [], files: [], edges: [] }, "table");

    expect(output).toBe(
      [
        "input: leaf",
        "depth: 2",
        "count: 0",
        "",
        "seeds",
        "+------+------+------+------+-----------+",
        "| Name | Kind | File | Line | Signature |",
        "+------+------+------+------+-----------+",
        "+------+------+------+------+-----------+",
        "0 rows",
        "",
        "affected",
        "+------+------+------+------+-----------+",
        "| Name | Kind | File | Line | Signature |",
        "+------+------+------+------+-----------+",
        "+------+------+------+------+-----------+",
        "0 rows",
        "",
        "files",
        "+------+",
        "| Path |",
        "+------+",
        "+------+",
        "0 rows",
      ].join("\n"),
    );
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

function createBranchCycleQueryResult(): LuaGraphQueryResult {
  const leaf = createSymbol("src/leaf.lua#function#leaf#1:1", "leaf", "src/leaf.lua", 1);
  const cycleA = createSymbol("src/cycle.lua#function#cycleA#4:1", "cycleA", "src/cycle.lua", 4);
  const cycleB = createSymbol("src/cycle.lua#function#cycleB#8:1", "cycleB", "src/cycle.lua", 8);
  const sideDoor = createSymbol("src/side.lua#function#sideDoor#1:1", "sideDoor", "src/side.lua", 1);

  return {
    projectRoot: "/tmp/project",
    expression: "callers:leaf",
    count: 3,
    nodes: [cycleA, cycleB, sideDoor],
    edges: [
      createEdge(cycleA.id, leaf.id, 5),
      createEdge(cycleB.id, cycleA.id, 9),
      createEdge(cycleA.id, cycleB.id, 6),
      createEdge(sideDoor.id, leaf.id, 2),
    ],
  };
}

function createCalleesResult(): LuaGraphQueryResult {
  const appBoot = createSymbol("src/app.lua#function#appBoot#1:1", "appBoot", "src/app.lua", 1);
  const leaf = createSymbol("src/api.lua#function#leaf#1:1", "leaf", "src/api.lua", 1);

  return {
    projectRoot: "/tmp/project",
    expression: "callees:appBoot",
    count: 1,
    nodes: [leaf],
    edges: [createEdge(appBoot.id, leaf.id, 2)],
  };
}

function createNameQueryResult(): LuaGraphQueryResult {
  const leaf = createSymbol("src/api.lua#function#leaf#1:1", "leaf", "src/api.lua", 1);

  return {
    projectRoot: "/tmp/project",
    expression: "name:leaf",
    count: 1,
    nodes: [leaf],
    edges: [],
  };
}

function createExtendsResult(): LuaGraphQueryResult {
  const child = createSymbol("src/child.lua#class#Child#1:1", "Child", "src/child.lua", 1);
  const base = {
    ...createSymbol("src/base.lua#table#Base#1:1", "Base", "src/base.lua", 1),
    kind: "table" as const,
    signature: "Base = {}",
  };

  return {
    projectRoot: "/tmp/project",
    expression: "extends:Child",
    count: 1,
    nodes: [base],
    edges: [createExtendsEdge(child.id, base.id)],
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

function createExtendsEdge(source: string, target: string) {
  return {
    kind: "Extends" as const,
    source,
    target,
  };
}
