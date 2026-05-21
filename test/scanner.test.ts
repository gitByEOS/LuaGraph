import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanLuaFiles } from "../src/core/scanner.js";
import type { LuaGraphConfig } from "../src/core/project-types.js";

const tempRoots: string[] = [];

describe("scanLuaFiles", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("returns lua file paths and metadata after include matching", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "src/main.lua", "return 1\n");
    await writeProjectFile(projectRoot, "src/nested/util.lua", "return 2\n");
    await writeProjectFile(projectRoot, "scripts/run.lua", "return 3\n");
    await writeProjectFile(projectRoot, "src/readme.txt", "not lua\n");

    const files = await scanLuaFiles(projectRoot, createConfig(["src/**/*.lua"], []));

    expect(files.map((file) => file.path)).toEqual(["src/main.lua", "src/nested/util.lua"]);
    expect(files[0]?.size).toBe(Buffer.byteLength("return 1\n"));
    expect(files[0]?.modifiedAt).toBeInstanceOf(Date);
  });

  it("supports .luagraph, directory and glob exclude rules", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "src/main.lua", "return 1\n");
    await writeProjectFile(projectRoot, ".luagraph/cache.lua", "return 2\n");
    await writeProjectFile(projectRoot, "node_modules/pkg/dep.lua", "return 3\n");
    await writeProjectFile(projectRoot, "vendor/node_modules/pkg/dep.lua", "return 4\n");
    await writeProjectFile(projectRoot, "build/output.lua", "return 5\n");

    const files = await scanLuaFiles(
      projectRoot,
      createConfig(["**/*.lua"], [".luagraph/**", "node_modules/", "build/**"]),
    );

    expect(files.map((file) => file.path)).toEqual(["src/main.lua"]);
  });

  it("scans nested directories with normalized Git style paths", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "game/play/round.lua", "return 1\n");

    const files = await scanLuaFiles(projectRoot, createConfig(["game/**/*.lua"], []));

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("game/play/round.lua");
  });

  it("counts LuaGraph Systems lua files without reading file contents", async () => {
    const files = await scanLuaFiles(
      "/Users/bole/dev/mul-agents/LuaGraph",
      createConfig(["Systems/**/*.lua"], [".luagraph/**"]),
    );

    expect(files).toHaveLength(18);
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "luagraph-scanner-"));
  tempRoots.push(projectRoot);
  return projectRoot;
}

async function writeProjectFile(projectRoot: string, path: string, content: string): Promise<void> {
  const filePath = join(projectRoot, path);

  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function createConfig(include: readonly string[], exclude: readonly string[]): LuaGraphConfig {
  return {
    include,
    exclude,
    databaseDir: ".luagraph/kuzu",
  };
}
