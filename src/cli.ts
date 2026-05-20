#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { Command } from "commander";

import { openUrl } from "./browser.js";
import { indexProject } from "./indexer.js";
import { initializeProject } from "./init.js";
import { sampleProject } from "./sample.js";
import { startServer } from "./server.js";
import { getProjectStatus } from "./status.js";
import { syncProject } from "./syncer.js";
import type { SampleResult, SyncResult } from "./types.js";

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
    .argument("[project_root]", "项目根目录，默认当前目录")
    .option("--project-root <path>", "项目根目录")
    .description("统计 LuaGraph 项目状态")
    .action(async (projectRoot?: string, options?: { readonly projectRoot?: string }) => {
      const targetProjectRoot = projectRoot ?? options?.projectRoot ?? process.cwd();

      try {
        const result = await getProjectStatus(targetProjectRoot);
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        program.error(error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command("sample")
    .argument("[project_root]", "项目根目录，默认当前目录")
    .option("--limit <n>", "抽查符号数量", "20")
    .option("--format <format>", "输出格式：json|table", "json")
    .description("抽查已索引的 Lua 符号")
    .action(async (projectRoot?: string, options?: SampleCommandOptions) => {
      const outputFormat = parseSampleOutputFormat(options?.format ?? "json");
      const limit = parseSampleLimit(options?.limit ?? "20");

      if (outputFormat === undefined) {
        program.error("sample --format 仅支持 json 或 table");
        return;
      }

      if (limit === undefined) {
        program.error("sample --limit 必须是正整数");
        return;
      }

      try {
        const result = await sampleProject(projectRoot ?? process.cwd(), { limit });
        console.log(formatSampleResult(result, outputFormat));
      } catch (error) {
        program.error(error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command("serve")
    .argument("[project_root]", "项目根目录，默认当前目录")
    .option("--port <port>", "HTTP 端口，默认随机可用端口", "0")
    .option("--open", "启动后用系统默认浏览器打开")
    .description("启动 LuaGraph 本地可视化服务")
    .action(async (projectRoot?: string, options?: ServeCommandOptions) => {
      const port = parseServePort(options?.port ?? "0");

      if (port === undefined) {
        program.error("serve --port 必须是 0 到 65535 的整数");
        return;
      }

      try {
        const server = await startServer(projectRoot ?? process.cwd(), { port });
        console.log(`LuaGraph serve listening on ${server.url}`);

        if (options?.open === true) {
          await openUrl(server.url);
        }
      } catch (error) {
        program.error(error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command("index")
    .argument("[project_root]", "项目根目录，默认当前目录")
    .option("--force", "强制重建索引")
    .option("--quiet", "静默执行，不输出结果")
    .option("--format <format>", "输出格式：json|table", "json")
    .description("索引 Lua 符号并写入 Kuzu 图数据库")
    .action(async (projectRoot?: string, options?: IndexCommandOptions) => {
      const outputFormat = parseIndexOutputFormat(options?.format ?? "json");

      if (outputFormat === undefined) {
        program.error("index --format 仅支持 json 或 table");
        return;
      }

      try {
        const result = await indexProject(projectRoot ?? process.cwd(), {
          force: options?.force === true,
          ...(options?.quiet === true
            ? {}
            : { onProgress: (message: string) => console.error(`[index] ${message}`) }),
        });

        if (options?.quiet === true) {
          return;
        }

        console.log(formatIndexResult(result, outputFormat));
      } catch (error) {
        program.error(error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command("sync")
    .argument("[project_root]", "项目根目录，默认当前目录")
    .option("--quiet", "静默执行，不输出结果")
    .option("--format <format>", "输出格式：json|table", "json")
    .description("基于 contentHash 增量刷新 LuaGraph 索引")
    .action(async (projectRoot?: string, options?: SyncCommandOptions) => {
      const outputFormat = parseSyncOutputFormat(options?.format ?? "json");

      if (outputFormat === undefined) {
        program.error("sync --format 仅支持 json 或 table");
        return;
      }

      try {
        const result = await syncProject(projectRoot ?? process.cwd());

        if (options?.quiet === true) {
          return;
        }

        console.log(formatSyncResult(result, outputFormat));
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

type IndexCommandOptions = {
  readonly force?: boolean;
  readonly quiet?: boolean;
  readonly format?: string;
};

type SyncCommandOptions = {
  readonly quiet?: boolean;
  readonly format?: string;
};

type SampleCommandOptions = {
  readonly limit?: string;
  readonly format?: string;
};

type ServeCommandOptions = {
  readonly port?: string;
  readonly open?: boolean;
};

type IndexOutputFormat = "json" | "table";
type SampleOutputFormat = "json" | "table";
type SyncOutputFormat = "json" | "table";

function parseIndexOutputFormat(value: string): IndexOutputFormat | undefined {
  return value === "json" || value === "table" ? value : undefined;
}

function parseSyncOutputFormat(value: string): SyncOutputFormat | undefined {
  return value === "json" || value === "table" ? value : undefined;
}

function parseSampleOutputFormat(value: string): SampleOutputFormat | undefined {
  return value === "json" || value === "table" ? value : undefined;
}

function parseSampleLimit(value: string): number | undefined {
  const limit = Number(value);

  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

function parseServePort(value: string): number | undefined {
  const port = Number(value);

  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : undefined;
}

function formatIndexResult(result: unknown, format: IndexOutputFormat): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  return JSON.stringify(result, null, 2);
}

function formatSampleResult(result: SampleResult, format: SampleOutputFormat): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  return [
    `projectRoot: ${result.projectRoot}`,
    `count: ${result.count}`,
    ...result.symbols.map(
      (symbol) =>
        `${symbol.filePath}:${symbol.startLine} ${symbol.kind} ${symbol.qualifiedName} local=${symbol.isLocal} ${symbol.signature}`,
    ),
  ].join("\n");
}

function formatSyncResult(result: SyncResult, format: SyncOutputFormat): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  return [
    `scannedFileCount: ${result.scannedFileCount}`,
    `changedFileCount: ${result.changedFileCount}`,
    `removedFileCount: ${result.removedFileCount}`,
    `symbolCount: ${result.symbolCount}`,
    `containsCount: ${result.containsCount}`,
    `databaseDir: ${result.databaseDir}`,
  ].join("\n");
}
