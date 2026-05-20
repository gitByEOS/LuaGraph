#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { Command } from "commander";

import { analyzeProject } from "./analyze.js";
import { initializeProject } from "./init.js";
import { getProjectStatus } from "./status.js";

export function createCli(): Command {
  const program = new Command();

  program.name("luagraph").description("LuaGraph local semantic graph CLI").version("0.1.0");

  program
    .command("init")
    .argument("[project_root]", "项目根目录")
    .description("初始化 LuaGraph 项目")
    .action(async (projectRoot?: string) => {
      if (projectRoot === undefined || projectRoot.length === 0) {
        program.error("请指定项目路径：luagraph init <project_root>");
        return;
      }

      try {
        const result = await initializeProject(projectRoot);
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        program.error(error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command("status")
    .argument("[project_root]", "项目根目录")
    .option("--project-root <path>", "项目根目录")
    .description("统计 LuaGraph 项目状态")
    .action(async (projectRoot?: string, options?: { readonly projectRoot?: string }) => {
      const targetProjectRoot = projectRoot ?? options?.projectRoot;

      if (targetProjectRoot === undefined || targetProjectRoot.length === 0) {
        program.error(
          "请指定项目路径：luagraph status <project_root> 或 luagraph status --project-root <path>",
        );
        return;
      }

      try {
        const result = await getProjectStatus(targetProjectRoot);
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        program.error(error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command("analyze")
    .argument("<project_root>", "项目根目录")
    .option("--include <pattern>", "文件匹配模式", "Systems/**/*.lua")
    .description("分析 Lua 符号并写入 Kuzu 图数据库")
    .action(async (projectRoot: string, options?: { readonly include?: string }) => {
      try {
        const result = await analyzeProject(projectRoot, options?.include ?? "Systems/**/*.lua");
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        program.error(error instanceof Error ? error.message : String(error));
      }
    });

  return program;
}

if (isCliEntrypoint()) {
  createCli().parseAsync();
}

function isCliEntrypoint(): boolean {
  const entrypoint = process.argv[1];

  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}
