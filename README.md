# LuaGraph

## 项目架构

LuaGraph v0.1.0 是一个 TypeScript CLI/library，用于扫描、解析 Lua 项目符号并写入 Kuzu 图数据库，最终提供依赖分析和可视化能力。工具链使用 Vite+ `vp`。

### 已完成模块

| 模块        | 文件                                       | 状态                      |
| ----------- | ------------------------------------------ | ------------------------- |
| 项目骨架    | `src/cli.ts`, `src/lib.ts`, `src/types.ts` | 已完成                    |
| 路径规范    | `src/path.ts`                              | 已完成                    |
| 配置读写    | `src/config.ts`                            | 已完成                    |
| Kuzu Schema | `src/store.ts`                             | 已完成                    |
| 文件扫描    | `src/scanner.ts`                           | 已完成                    |
| Lua 解析    | `src/parser.ts`                            | 已完成 (Phase 1 行级模式) |
| 流程编排    | `src/init.ts`                              | 已完成                    |
| 状态统计    | `src/status.ts`                            | 已完成                    |
| 索引写入    | `src/indexer.ts`                           | 已完成                    |
| 抽查入口    | `src/sample.ts`                            | 已完成                    |

### 模块结构

- `src/cli.ts`：CLI 入口，支持 `luagraph init`、`luagraph status`、`luagraph index` 和 `luagraph sample` 命令。
- `src/lib.ts`：公共库出口。
- `src/types.ts`：配置、schema、路径、init、扫描器和状态类型。
- `src/config.ts`：配置读写校验，默认读取 `.gitignore` 生成 exclude。
- `src/path.ts`：Git 风格路径规范化和安全解析。
- `src/store.ts`：Kuzu schema 入口，定义 File/Symbol 节点和关系。
- `src/scanner.ts`：按配置扫描 Lua 文件并返回仓库相对路径。
- `src/parser.ts`：Phase 1 Lua 符号最小提取，输出 File 与 Symbol 结构。
- `src/status.ts`：读取项目配置和 Kuzu 库，统计 File、Symbol、关系、解析错误、符号分类与待同步变化数量。
- `src/sample.ts`：index 后从 Kuzu 抽查少量 Symbol 字段，作为和 status 同级的验证入口。
- `src/init.ts`：初始化流程编排入口。
- `test/`：测试。

## 验收标准

| 模块      | 验收脚本                         | 验证内容                                                                                                                        |
| --------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Init      | `submit/test-agent-init.sh`      | `vp install && vp test && vp check`                                                                                             |
| Path      | `submit/test-agent-path.sh`      | `vp test test/path.test.ts && vp check`                                                                                         |
| Config    | `submit/test-agent-config.sh`    | `vp test test/config.test.ts && vp check`                                                                                       |
| Store     | `submit/test-agent-store.sh`     | `vp install && vp test test/store.test.ts && vp check`                                                                          |
| Scanner   | `submit/test-agent-scanner.sh`   | `vp test test/scanner.test.ts && vp check`                                                                                      |
| Parser    | `submit/test-agent-parser.sh`    | `vp test test/parser.test.ts && vp check`                                                                                       |
| Init-real | `submit/test-agent-init-real.sh` | `vp install && vp test && vp check && vp run build`，然后 `node dist/cli.js init <tmp>` 验证 `.luagraph/` 创建                  |
| Status    | `submit/test-agent-status.sh`    | `vp test test/status.test.ts && vp check && vp run build`，CLI 支持 `luagraph status` 默认当前目录、显式路径和 `--project-root <path>` |
| Index     | `submit/test-index.sh`           | `npm run typecheck && npx vitest run && npm run build`，CLI `init` + `index` 写入 Kuzu |
| Verify    | `submit/test-agent-verify.sh`    | CLI + `test/verify.test.ts`，index 后 status 输出非零计数                              |
| Status Accuracy | `submit/test-status-accuracy.sh` | `npm run typecheck && npx vitest run && npm run build`，CLI 临时项目无参 `status` 验证符号分类、解析错误和待同步变化 |
| Sample    | `submit/test-sample.sh`          | `npm run typecheck && npx vitest run test/sample.test.ts test/cli.test.ts && npm run build`，CLI 临时项目 `init/index/sample` 验证 JSON 字段 |

## Systems/ 分析（已完成 ✅）

对 18 个 Lua 文件的完整分析流程：

| 分支           | 状态    | 任务                        | 验收目标                              |
| -------------- | ------- | --------------------------- | ------------------------------------- |
| systems-scan   | 已完成  | 扫描 Systems/ 全部 Lua 文件 | scanner 输出 18 个文件路径            |
| systems-parse  | 已完成  | 索引符号写入 Kuzu           | parser 提取所有 class/function/method |
| systems-verify | 已完成  | 验证图数据完整性            | status 输出非零计数                   |
