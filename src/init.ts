import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { configPath, createDefaultConfig, readConfig, writeConfig } from "./config.js";
import { initializeStore, schemaStatements } from "./store.js";
import type { InitPlan, InitResult } from "./types.js";

export function createInitPlan(projectRoot: string): InitPlan {
  return {
    projectRoot,
    config: createDefaultConfig(),
    schema: schemaStatements,
  };
}

export async function initializeProject(projectRoot: string): Promise<InitResult> {
  const resolvedProjectRoot = resolve(projectRoot);

  await assertExistingDirectory(resolvedProjectRoot, projectRoot);
  await mkdir(join(resolvedProjectRoot, ".luagraph"), { recursive: true });

  await writeConfig(resolvedProjectRoot);
  const config = await readConfig(resolvedProjectRoot);

  if (config === undefined) {
    throw new Error("初始化配置失败：未生成 .luagraph/config.json");
  }

  const databaseDir = resolve(resolvedProjectRoot, config.databaseDir);
  await initializeStore(databaseDir);

  return {
    projectRoot: resolvedProjectRoot,
    configPath: join(resolvedProjectRoot, configPath),
    databaseDir,
    schemaCount: schemaStatements.length,
  };
}

async function assertExistingDirectory(
  resolvedProjectRoot: string,
  inputProjectRoot: string,
): Promise<void> {
  let stats;

  try {
    stats = await stat(resolvedProjectRoot);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error(`项目路径不存在：${inputProjectRoot}`);
    }

    throw error;
  }

  if (!stats.isDirectory()) {
    throw new Error(`项目路径不是目录：${inputProjectRoot}`);
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
