import { describe, expect, it } from "vitest";

import { formatExplainResult, formatImpactResult, formatQueryResult } from "../src/cli/format.js";
import type { LuaGraphExplainResult, LuaGraphImpactResult, LuaGraphQueryResult } from "../src/core/project-types.js";

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
        "+-------+--------+-----------------+----------------+",
        "| Child | Parent | Child File      | Parent File    |",
        "+-------+--------+-----------------+----------------+",
        "| Child | Base   | src/child.lua:1 | src/base.lua:1 |",
        "+-------+--------+-----------------+----------------+",
        "1 rows, target: Child (src/child.lua:1)",
      ].join("\n"),
    );
    expect(formatQueryResult(createExtendsResult(), "tree")).toBe(
      ["Child()  (src/child.lua:1)", "└── extends Base [src/base.lua:1]"].join("\n"),
    );
  });

  it("requires table 同时展示来源和目标文件", () => {
    expect(formatQueryResult(createRequiresResult(), "table")).toBe(
      [
        "+----------------+---------------+--------+----------+",
        "| Requiring File | Required File | Module | Resolved |",
        "+----------------+---------------+--------+----------+",
        "| src/main.lua   | src/utils.lua | utils  | true     |",
        "+----------------+---------------+--------+----------+",
        "1 rows, target: *",
      ].join("\n"),
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

  it("impact tree 展示反向 Extends 子类", () => {
    expect(formatImpactResult(createExtendsImpactResult(), "tree")).toBe(
      [
        "Base()  (src/base.lua:1)",
        "└── subclass Child [src/child.lua:1]",
        "    └── subclass GrandChild [src/grand.lua:1]",
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

  it("explain text 使用固定 Markdown 模板", () => {
    const output = formatExplainResult(createExplainResult(), "text");

    expect(output).toContain("# Explain: src/main.lua");
    expect(output).toContain("## Overview");
    expect(output).toContain("- file: src/main.lua");
    expect(output).toContain("- symbols: 4");
    expect(output).toContain("- calls: 2");
    expect(output).toContain("- requires: 2");
    expect(output).toContain("## Internal Logic");
    expect(output).not.toContain("## Main Logic");
    expect(output).toContain("- reason: exported");
    expect(output).toContain("- reason: external-call");
    expect(output).not.toContain("commands:");
    expect(output).not.toContain("luagraph explain boot --depth 2");
    expect(output).not.toContain("luagraph query callees:boot --depth 2 --format tree");
    expect(output).not.toContain("luagraph explain ");
    expect(output).toContain("1. boot");
    expect(output).toContain("   - calls: helper, externalHelper");
    expect(output).toContain("     - flag -> boot");
    expect(output).toContain("- input src/main.lua");
    expect(output).toContain("- entrypoint boot");
    expect(output).toContain("- call helper");
    expect(output).toContain("- utils");
    expect(output).toContain("  - reason: project-dependency");
    expect(output).toContain("- externalHelper");
    expect(output).toContain("  - reason: cross-file-call");
    expect(output).toContain("## Unresolved Runtime\n- missing");
    expect(output).not.toContain("safeConclusion");
    expect(output).not.toContain("nextQueries");
    expect(output).not.toContain("externalGaps:");
  });

  it("explain text 超过 20 个入口时显示省略", () => {
    const output = formatExplainResult(
      {
        ...createExplainResult(),
        entrypoints: Array.from({ length: 21 }, (_, index) => ({
          name: `entry${index}`,
          qualifiedName: `entry${index}`,
          kind: "function",
          filePath: "src/main.lua",
          startLine: index + 1,
          isExported: true,
          externalCallCount: 0,
        })),
      },
      "text",
    );

    expect(output).toContain("- entry19");
    expect(output).not.toContain("- entry20");
    expect(output).toContain("- ...");
  });

  it("explain text 空态使用 None", () => {
    const output = formatExplainResult(
      {
        ...createExplainResult(),
        entrypoints: [],
        flow: [],
        branches: [],
        dependencies: [],
        dataFlow: [],
        externalGaps: [],
      },
      "text",
    );

    expect(output).toContain("## Entry Points\n- None");
    expect(output).toContain("## Internal Logic\n1. None");
    expect(output).toContain("## Data Flow\n- None");
    expect(output).toContain("## External Contracts\n- None");
    expect(output).toContain("## Unresolved Runtime\n- None");
    expect(output).not.toContain("无");
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

function createRequiresResult(): LuaGraphQueryResult {
  return {
    projectRoot: "/tmp/project",
    expression: "requires:*",
    count: 1,
    nodes: [
      {
        type: "File",
        id: "src/utils.lua",
        kind: "file",
        name: "utils.lua",
        path: "src/utils.lua",
      },
    ],
    edges: [
      {
        kind: "Requires",
        source: "src/main.lua",
        target: "src/utils.lua",
        moduleName: "utils",
        isResolved: true,
      },
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

function createExtendsImpactResult(): LuaGraphImpactResult {
  const base = createSymbol("src/base.lua#class#Base#1:1", "Base", "src/base.lua", 1);
  const child = createSymbol("src/child.lua#class#Child#1:1", "Child", "src/child.lua", 1);
  const grandChild = createSymbol("src/grand.lua#class#GrandChild#1:1", "GrandChild", "src/grand.lua", 1);

  return {
    projectRoot: "/tmp/project",
    input: "Base",
    depth: 2,
    seeds: [base],
    count: 2,
    nodes: [child, grandChild],
    files: ["src/child.lua", "src/grand.lua"],
    edges: [
      createExtendsEdge(child.id, base.id),
      createExtendsEdge(grandChild.id, child.id),
    ],
  };
}

function createExplainResult(): LuaGraphExplainResult {
  return {
    projectRoot: "/tmp/project",
    input: "src/main.lua",
    depth: 2,
    target: {
      type: "file",
      name: "main.lua",
      filePath: "src/main.lua",
    },
    entrypoints: [
      {
        name: "boot",
        qualifiedName: "boot",
        kind: "function",
        filePath: "src/main.lua",
        startLine: 3,
        isExported: true,
        externalCallCount: 0,
      },
      {
        name: "fallback",
        qualifiedName: "fallback",
        kind: "function",
        filePath: "src/main.lua",
        startLine: 9,
        isExported: false,
        externalCallCount: 1,
      },
    ],
    flow: [
      {
        entrypoint: "boot",
        filePath: "src/main.lua",
        calls: [
          {
            from: "boot",
            to: "helper",
            filePath: "src/main.lua",
            line: 5,
            isResolved: true,
            calls: [],
          },
          {
            from: "boot",
            to: "externalHelper",
            filePath: "src/utils.lua",
            line: 6,
            isResolved: true,
            calls: [],
          },
        ],
      },
    ],
    branches: [
      {
        functionName: "boot",
        line: 4,
        kind: "if",
        condition: "flag",
      },
    ],
    dependencies: [
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
    ],
    dataFlow: [
      {
        order: 1,
        label: "input:src/main.lua",
        source: "input",
        filePath: "src/main.lua",
      },
      {
        order: 2,
        label: "入口 boot",
        source: "entrypoint",
        filePath: "src/main.lua",
        line: 3,
      },
      {
        order: 3,
        label: "调用 helper",
        source: "callee",
        filePath: "src/main.lua",
        line: 5,
      },
      {
        order: 4,
        label: "return result",
        source: "return",
        filePath: "src/main.lua",
        line: 8,
      },
    ],
    externalGaps: [
      "外部依赖需查看: utils -> src/utils.lua",
      "外部函数需查看: externalHelper -> src/utils.lua",
      "未解析 require/import: missing",
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
