#!/usr/bin/env node

import { Command } from "commander";

import { createInitPlan } from "./init.js";

export function createCli(): Command {
  const program = new Command();

  program.name("luagraph").description("LuaGraph local semantic graph CLI").version("0.1.0");

  program
    .command("init")
    .argument("[project_root]", "项目根目录")
    .description("初始化 LuaGraph 项目")
    .action((projectRoot?: string) => {
      if (projectRoot === undefined || projectRoot.length === 0) {
        program.error("请指定项目路径：luagraph init <project_root>");
      }

      const plan = createInitPlan(projectRoot);
      console.log(JSON.stringify(plan, null, 2));
    });

  return program;
}

createCli().parse();
