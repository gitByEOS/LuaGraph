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
