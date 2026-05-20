import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createProjectConfig, readConfig, validateConfig, writeConfig } from "../src/config.js";
import type { LuaGraphConfig } from "../src/types.js";

const tempRoots: string[] = [];

describe("config", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("uses .gitignore rules as default exclude", async () => {
    const projectRoot = await createTempProject();
    await writeFile(
      join(projectRoot, ".gitignore"),
      "# comment\nnode_modules/\n\nbuild/**\n",
      "utf8",
    );

    const config = await writeConfig(projectRoot);
    const writtenConfig = JSON.parse(
      await readFile(join(projectRoot, ".luagraph/config.json"), "utf8"),
    );

    expect(config).toEqual({
      include: ["**/*.lua"],
      exclude: [".luagraph/**", "node_modules/", "build/**"],
      databaseDir: ".luagraph/kuzu",
    });
    expect(writtenConfig).toEqual(config);
  });

  it("creates valid config without .gitignore", async () => {
    const projectRoot = await createTempProject();

    await expect(createProjectConfig(projectRoot)).resolves.toEqual({
      include: ["**/*.lua"],
      exclude: [".luagraph/**"],
      databaseDir: ".luagraph/kuzu",
    });
  });

  it("keeps existing valid config", async () => {
    const projectRoot = await createTempProject();
    const existingConfig: LuaGraphConfig = {
      include: ["src/**/*.lua"],
      exclude: [".luagraph/**", "vendor/**"],
      databaseDir: ".custom/kuzu",
    };

    await mkdir(join(projectRoot, ".luagraph"), { recursive: true });
    await writeFile(
      join(projectRoot, ".luagraph/config.json"),
      `${JSON.stringify(existingConfig)}\n`,
      "utf8",
    );

    const config = await writeConfig(projectRoot);
    const writtenText = await readFile(join(projectRoot, ".luagraph/config.json"), "utf8");

    expect(config).toEqual(existingConfig);
    expect(writtenText).toBe(`${JSON.stringify(existingConfig)}\n`);
    await expect(readConfig(projectRoot)).resolves.toEqual(existingConfig);
  });

  it("rejects invalid include and exclude", () => {
    expect(() =>
      validateConfig({
        include: [],
        exclude: [],
        databaseDir: ".luagraph/kuzu",
      }),
    ).toThrow("config.include 不能为空");

    expect(() =>
      validateConfig({
        include: ["**/*.lua"],
        exclude: [""],
        databaseDir: ".luagraph/kuzu",
      }),
    ).toThrow("config.exclude[0] 必须是非空字符串");
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "luagraph-config-"));
  tempRoots.push(projectRoot);
  return projectRoot;
}
