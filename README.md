# LuaGraph

## 项目架构

LuaGraph v0.1.0 是一个 TypeScript CLI/library，用于扫描、解析 Lua 项目符号并写入 Kuzu 图数据库，最终提供依赖分析和可视化能力。工具链使用 Vite+ `vp`。

### 已完成模块

| 模块 | 文件 | 状态 |
|---|---|---|
| 项目骨架 | `src/cli.ts`, `src/lib.ts`, `src/types.ts` | 已完成 |
| 路径规范 | `src/path.ts` | 已完成 |
| 配置读写 | `src/config.ts` | 已完成 |
| Kuzu Schema | `src/store.ts` | 已完成 |
| 文件扫描 | `src/scanner.ts` | 已完成 |
| Lua 解析 | `src/parser.ts` | 已完成 (Phase 1 行级模式) |
| 流程编排 | `src/init.ts` | 已完成 |
| 状态统计 | `src/status.ts` | 已完成 |

### 模块结构

- `src/cli.ts`：CLI 入口，支持 `luagraph init` 和 `luagraph status` 命令。
- `src/lib.ts`：公共库出口。
- `src/types.ts`：配置、schema、路径、init、扫描器和状态类型。
- `src/config.ts`：配置读写校验，默认读取 `.gitignore` 生成 exclude。
- `src/path.ts`：Git 风格路径规范化和安全解析。
- `src/store.ts`：Kuzu schema 入口，定义 File/Symbol 节点和关系。
- `src/scanner.ts`：按配置扫描 Lua 文件并返回仓库相对路径。
- `src/parser.ts`：Phase 1 Lua 符号最小提取，输出 File 与 Symbol 结构。
- `src/status.ts`：读取项目配置和 Kuzu 库，统计 File、Symbol 与关系数量。
- `src/init.ts`：初始化流程编排入口。
- `test/`：测试。

## 验收标准

| 模块 | 验收脚本 | 验证内容 |
|---|---|---|
| Init | `submit/test-agent-init.sh` | `vp install && vp test && vp check` |
| Path | `submit/test-agent-path.sh` | `vp test test/path.test.ts && vp check` |
| Config | `submit/test-agent-config.sh` | `vp test test/config.test.ts && vp check` |
| Store | `submit/test-agent-store.sh` | `vp install && vp test test/store.test.ts && vp check` |
| Scanner | `submit/test-agent-scanner.sh` | `vp test test/scanner.test.ts && vp check` |
| Parser | `submit/test-agent-parser.sh` | `vp test test/parser.test.ts && vp check` |
| Init-real | `submit/test-agent-init-real.sh` | `vp install && vp test && vp check && vp run build`，然后 `node dist/cli.js init <tmp>` 验证 `.luagraph/` 创建 |
| Status | `submit/test-agent-status.sh` | `vp test test/status.test.ts && vp check && vp run build`，CLI 支持 `luagraph status <project_root>` 和 `--project-root <path>` |

## 下一阶段：Systems/ 分析

目标：使用已产出的工具链对 `Systems/` 目录下的真实业务代码进行完整分析，将 Lua 符号写入 Kuzu 图数据库。

共 18 个 Lua 文件，分布在 5 个系统：

| 系统 | 文件数 | 说明 |
|---|---|---|
| Diner | 9 | 餐厅系统（含 DinerBaking 子模块） |
| HotShooter | 5 | 射击系统 |
| MissionBlitz | 2 | 任务突击系统 |
| RecallSale | 1 | 召回促销系统 |
| XtraSpinDialog | 1 | 额外旋转对话框 |

### 任务拆分

| 分支 | 任务 | 依赖 | 可并行 | 验收目标 |
|---|---|---|---|---|
| systems-scan | 扫描 Systems/ 全部 Lua 文件 | status:已完成 | 是 | scanner 输出 18 个文件路径 |
| systems-parse | 解析 Systems/ 符号写入 Kuzu | systems-scan:已完成 | 否 | parser 提取所有 class/function/method |
| systems-verify | 验证图数据完整性 | systems-parse:已完成 | 否 | status 输出非零计数 |
