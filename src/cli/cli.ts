#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { Command } from "commander";

import { openUrl } from "./browser.js";
import { formatExplainResult, formatImpactResult, formatQueryResult, type ExplainOutputFormat, type GraphOutputFormat } from "./format.js";
import { explainProject } from "../core/explain.js";
import { impactProject } from "../core/impact.js";
import { indexProject } from "../core/indexer.js";
import { initializeProject } from "../core/init.js";
import { queryProject } from "../core/query.js";
import { sampleProject } from "../core/sample.js";
import { startServer } from "../web/server.js";
import { getProjectStatus } from "../core/status.js";
import { syncProject } from "../core/syncer.js";
import type { SampleResult, SyncResult } from "../core/project-types.js";

const queryHelpText = `
查询表达式:
  name:<symbol>              按符号名或 qualifiedName 查询
  kind:<kind>                按类型查询，如 class、function、method、file
  callers:<symbol>           查询谁调用了该符号，用于看影响范围
  callees:<symbol>           查询该符号调用了谁，用于看内部依赖
  extends:<symbol>           查询该符号继承的父级
  subclasses:<symbol>        查询继承该符号的子级
  requires:<path-part>       查询路径片段匹配的文件 require 了哪些项目内文件
  dependents:<path-part>     查询哪些文件 require 了路径片段匹配的文件
  kind:<kind> name:<symbol>  组合过滤

示例:
  luagraph query name:ThemeCollectDialog --format table
  luagraph query kind:class --format table
  luagraph query callers:ThemeCollectDialog --depth 2 --format tree
  luagraph query callees:ThemeProgressDialog:collectMaterial --depth 2 --format tree
  luagraph query extends:Child --format table
  luagraph query subclasses:Base --depth 2 --format tree
  luagraph query requires:src/main.lua --format json
  luagraph query dependents:src/utils.lua --format json
  luagraph query kind:method name:collectMaterial --format table
`;

const impactHelpText = `
说明:
  impact 从文件或符号出发，沿 Calls 反向关系查找受影响调用者。
  文件输入会同时沿 Requires 反向关系查找依赖它的文件。

示例:
  luagraph impact ThemeCollectDialog --format table
  luagraph impact ThemeCollectDialog --depth 2 --format tree
  luagraph impact Diner/DinerDialogs.lua --format json
`;

const explainHelpText = `
说明:
  explain 从文件或符号出发解释入口、调用流、分支、依赖和外部缺口。
  explain 只按需读取单文件源码，不写回 .luagraph。

示例:
  luagraph explain src/core/query.ts --format text
  luagraph explain queryProject --depth 2 --format json --project-root .
`;

const indexHelpText = `
示例:
  luagraph index .
  luagraph index /path/to/lua-project --force --format json
  luagraph index . --quiet
`;

const syncHelpText = `
说明:
  sync 基于 contentHash 刷新增、改、删的 Lua 文件。
  非 quiet 模式下进度写入 stderr，json/table 结果写入 stdout。

示例:
  luagraph sync .
  luagraph sync /path/to/lua-project --format table
  luagraph sync . --quiet
`;

export function createCli(): Command {
  const program = new Command();

  program.name("luagraph").description("LuaGraph 本地 Lua 语义图谱 CLI").version("0.1.0");

  program
    .command("init")
    .argument("[project_root]", "要初始化的 Lua 项目根目录")
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
    .argument("[project_root]", "Lua 项目根目录，默认当前目录")
    .option("--project-root <path>", "Lua 项目根目录，优先级高于位置参数")
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
    .argument("[project_root]", "Lua 项目根目录，默认当前目录")
    .option("--limit <n>", "最多抽查的符号数量", "20")
    .option("--format <format>", "输出格式：json 或 table", "json")
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
    .command("query")
    .argument("<expression...>", "查询表达式，见下方“查询表达式”说明")
    .option("--format <format>", "输出格式：json、table 或 tree", "json")
    .option("--depth <n>", "callers/callees 关系展开深度", "1")
    .option("--project-root <path>", "Lua 项目根目录，默认当前目录")
    .description("查询已索引的 LuaGraph 图")
    .action(async (expressionParts: string[], options?: QueryCommandOptions) => {
      const outputFormat = parseQueryOutputFormat(options?.format ?? "json");
      const depth = parseQueryDepth(options?.depth ?? "1");

      if (outputFormat === undefined) {
        program.error("query --format 仅支持 json、table 或 tree");
        return;
      }

      if (depth === undefined) {
        program.error("query --depth 必须是正整数");
        return;
      }

      try {
        const result = await queryProject(options?.projectRoot ?? process.cwd(), expressionParts.join(" "), {
          depth,
        });
        console.log(formatQueryResult(result, outputFormat));
      } catch (error) {
        program.error(error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command("impact")
    .argument("<file-or-symbol>", "文件路径、符号名或 qualifiedName")
    .option("--format <format>", "输出格式：json、table 或 tree", "json")
    .option("--depth <n>", "反向调用链展开深度", "2")
    .option("--project-root <path>", "Lua 项目根目录，默认当前目录")
    .description("分析文件或符号的反向调用影响范围")
    .action(async (input: string, options?: ImpactCommandOptions) => {
      const outputFormat = parseGraphOutputFormat(options?.format ?? "json");
      const depth = parseGraphDepth(options?.depth ?? "2");

      if (outputFormat === undefined) {
        program.error("impact --format 仅支持 json、table 或 tree");
        return;
      }

      if (depth === undefined) {
        program.error("impact --depth 必须是正整数");
        return;
      }

      try {
        const result = await impactProject(options?.projectRoot ?? process.cwd(), input, { depth });
        console.log(formatImpactResult(result, outputFormat));
      } catch (error) {
        program.error(error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command("explain")
    .argument("<file-or-symbol>", "文件路径、符号名或 qualifiedName")
    .option("--depth <n>", "解释调用流展开深度", "2")
    .option("--format <format>", "输出格式：json 或 text", "text")
    .option("--project-root <path>", "Lua 项目根目录，默认当前目录")
    .description("解释文件或符号的语义链路")
    .action(async (input: string, options?: ExplainCommandOptions) => {
      const outputFormat = parseExplainOutputFormat(options?.format ?? "text");
      const depth = parseGraphDepth(options?.depth ?? "2");

      if (outputFormat === undefined) {
        program.error("explain --format 仅支持 json 或 text");
        return;
      }

      if (depth === undefined) {
        program.error("explain --depth 必须是正整数");
        return;
      }

      try {
        const result = await explainProject(options?.projectRoot ?? process.cwd(), input, { depth });
        console.log(formatExplainResult(result, outputFormat));
      } catch (error) {
        program.error(error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command("serve")
    .argument("[project_root]", "Lua 项目根目录，默认当前目录")
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
    .argument("[project_root]", "Lua 项目根目录，默认当前目录")
    .option("--force", "强制重建索引")
    .option("--quiet", "静默执行，不输出进度和结果")
    .option("--format <format>", "输出格式：json 或 table", "json")
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
    .argument("[project_root]", "Lua 项目根目录，默认当前目录")
    .option("--quiet", "静默执行，不输出进度和结果")
    .option("--format <format>", "输出格式：json 或 table", "json")
    .description("基于 contentHash 增量刷新 LuaGraph 索引")
    .action(async (projectRoot?: string, options?: SyncCommandOptions) => {
      const outputFormat = parseSyncOutputFormat(options?.format ?? "json");

      if (outputFormat === undefined) {
        program.error("sync --format 仅支持 json 或 table");
        return;
      }

      try {
        const result = await syncProject(projectRoot ?? process.cwd(), {
          ...(options?.quiet === true
            ? {}
            : { onProgress: (message: string) => console.error(`[sync] ${message}`) }),
        });

        if (options?.quiet === true) {
          return;
        }

        console.log(formatSyncResult(result, outputFormat));
      } catch (error) {
        program.error(error instanceof Error ? error.message : String(error));
      }
    });

  appendHelpFooter(program, "query", queryHelpText);
  appendHelpFooter(program, "impact", impactHelpText);
  appendHelpFooter(program, "explain", explainHelpText);
  appendHelpFooter(program, "index", indexHelpText);
  appendHelpFooter(program, "sync", syncHelpText);

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

type QueryCommandOptions = {
  readonly format?: string;
  readonly depth?: string;
  readonly projectRoot?: string;
};

type ImpactCommandOptions = {
  readonly format?: string;
  readonly depth?: string;
  readonly projectRoot?: string;
};

type ExplainCommandOptions = {
  readonly format?: string;
  readonly depth?: string;
  readonly projectRoot?: string;
};

type ServeCommandOptions = {
  readonly port?: string;
  readonly open?: boolean;
};

type IndexOutputFormat = "json" | "table";
type SampleOutputFormat = "json" | "table";
type SyncOutputFormat = "json" | "table";

function appendHelpFooter(program: Command, commandName: string, footer: string): void {
  const command = program.commands.find((item) => item.name() === commandName);

  if (command === undefined) {
    throw new Error(`命令不存在: ${commandName}`);
  }

  const readHelp = command.helpInformation.bind(command);
  command.helpInformation = () => `${readHelp()}${footer}`;
}

function parseIndexOutputFormat(value: string): IndexOutputFormat | undefined {
  return value === "json" || value === "table" ? value : undefined;
}

function parseSyncOutputFormat(value: string): SyncOutputFormat | undefined {
  return value === "json" || value === "table" ? value : undefined;
}

function parseSampleOutputFormat(value: string): SampleOutputFormat | undefined {
  return value === "json" || value === "table" ? value : undefined;
}

function parseQueryOutputFormat(value: string): GraphOutputFormat | undefined {
  return parseGraphOutputFormat(value);
}

function parseGraphOutputFormat(value: string): GraphOutputFormat | undefined {
  return value === "json" || value === "table" || value === "tree" ? value : undefined;
}

function parseExplainOutputFormat(value: string): ExplainOutputFormat | undefined {
  return value === "json" || value === "text" ? value : undefined;
}

function parseSampleLimit(value: string): number | undefined {
  const limit = Number(value);

  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

function parseQueryDepth(value: string): number | undefined {
  return parseGraphDepth(value);
}

function parseGraphDepth(value: string): number | undefined {
  const depth = Number(value);

  return Number.isInteger(depth) && depth > 0 ? depth : undefined;
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
    `extendsCount: ${result.extendsCount}`,
    `requiresCount: ${result.requiresCount}`,
    `databaseDir: ${result.databaseDir}`,
  ].join("\n");
}
