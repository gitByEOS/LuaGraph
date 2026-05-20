import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { LuaGraphConfig } from "./types.js";

export const configPath = ".luagraph/config.json";

export const defaultConfig: LuaGraphConfig = {
  include: ["**/*.lua"],
  exclude: [".luagraph/**"],
  databaseDir: ".luagraph/kuzu",
};

export function createDefaultConfig(exclude: readonly string[] = []): LuaGraphConfig {
  const mergedExclude = uniquePatterns([...defaultConfig.exclude, ...exclude]);

  return {
    include: [...defaultConfig.include],
    exclude: mergedExclude,
    databaseDir: defaultConfig.databaseDir,
  };
}

export async function createProjectConfig(projectRoot: string): Promise<LuaGraphConfig> {
  const gitignoreExclude = await readGitignoreExclude(projectRoot);

  return createDefaultConfig(gitignoreExclude);
}

export async function readConfig(projectRoot: string): Promise<LuaGraphConfig | undefined> {
  try {
    const configText = await readFile(resolveConfigPath(projectRoot), "utf8");
    return validateConfig(JSON.parse(configText));
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

export async function writeConfig(projectRoot: string): Promise<LuaGraphConfig> {
  const existingConfig = await readConfig(projectRoot);

  if (existingConfig) {
    return existingConfig;
  }

  const config = await createProjectConfig(projectRoot);
  const targetPath = resolveConfigPath(projectRoot);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(config, undefined, 2)}\n`, "utf8");

  return config;
}

export function validateConfig(config: unknown): LuaGraphConfig {
  if (!isRecord(config)) {
    throw new Error("config 必须是对象");
  }

  const include = readPatternArray(config.include, "include", { requireNonEmpty: true });
  const exclude = readPatternArray(config.exclude, "exclude", { requireNonEmpty: false });

  if (typeof config.databaseDir !== "string" || config.databaseDir.trim() === "") {
    throw new Error("config.databaseDir 必须是非空字符串");
  }

  return {
    include,
    exclude: uniquePatterns([".luagraph/**", ...exclude]),
    databaseDir: config.databaseDir,
  };
}

async function readGitignoreExclude(projectRoot: string): Promise<string[]> {
  try {
    const gitignoreText = await readFile(join(projectRoot, ".gitignore"), "utf8");
    return gitignoreText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
}

function resolveConfigPath(projectRoot: string): string {
  return join(projectRoot, configPath);
}

function readPatternArray(
  value: unknown,
  name: "include" | "exclude",
  options: { readonly requireNonEmpty: boolean },
): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`config.${name} 必须是字符串数组`);
  }

  if (options.requireNonEmpty && value.length === 0) {
    throw new Error(`config.${name} 不能为空`);
  }

  value.forEach((pattern, index) => {
    if (typeof pattern !== "string" || pattern.trim() === "") {
      throw new Error(`config.${name}[${index}] 必须是非空字符串`);
    }
  });

  return [...value];
}

function uniquePatterns(patterns: readonly string[]): string[] {
  return [...new Set(patterns)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
