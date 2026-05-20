# LuaGraph

## 项目架构

LuaGraph v0.7.0 是一个 TypeScript CLI/library，用于扫描 Lua 项目、提取可索引符号与调用关系，并写入 Kuzu 图数据库。当前 CLI 覆盖 `init`、`status`、`index`、`sync`、`sample`、`query`、`impact` 和 `serve`，工具链使用 npm scripts 与 Vitest/TypeScript。

### 已完成模块

| 模块        | 文件                                       | 状态 |
| ----------- | ------------------------------------------ | ---- |
| 项目骨架    | `src/cli.ts`, `src/lib.ts`, `src/types.ts` | 已完成 |
| 路径规范    | `src/path.ts`                              | 已完成 |
| 配置读写    | `src/config.ts`                            | 已完成 |
| Kuzu Schema | `src/store.ts`                             | 已完成 |
| 文件扫描    | `src/scanner.ts`                           | 已完成 |
| 流程编排    | `src/init.ts`                              | 已完成 |
| 状态统计    | `src/status.ts`                            | 已完成 |
| 索引写入    | `src/indexer.ts`, `src/call-graph.ts`      | 已完成 (File/Symbol/Contains/Calls) |
| 抽查入口    | `src/sample.ts`                            | 已完成 |
| 本地服务    | `src/server.ts`, `src/web/*`               | 已完成 (第一版可视化) |
| v0.4 解析准确性 | `src/parser.ts`, `test/parser.test.ts` | 已完成 (行级模式，含函数作用域结束行和调用提取) |
| v0.5 增量同步 | `src/syncer.ts`                          | 已完成 |
| v0.6 图查询 | `src/query.ts`                             | 已完成 |
| v0.7 影响分析 | `src/impact.ts`                          | 已完成 |
| v0.7 输出格式 | `src/format.ts`                          | 已完成 (query/impact 的 json/table/tree) |

### 模块结构

- `src/cli.ts`：CLI 入口，支持 `luagraph init`、`luagraph status`、`luagraph index`、`luagraph sync`、`luagraph sample`、`luagraph query`、`luagraph impact` 和 `luagraph serve` 命令。
- `src/lib.ts`：公共库出口。
- `src/types.ts`：配置、schema、路径、init、扫描器和状态类型。
- `src/config.ts`：配置读写校验，默认读取 `.gitignore` 生成 exclude。
- `src/path.ts`：Git 风格路径规范化和安全解析。
- `src/store.ts`：Kuzu schema 入口，定义 File/Symbol 节点和 Contains/Calls/Requires/Extends 关系表。
- `src/scanner.ts`：按配置扫描 Lua 文件并返回仓库相对路径。
- `src/parser.ts`：行级 Lua 符号和调用提取，输出 File、Symbol 与 Call 结构。
- `src/status.ts`：读取项目配置和 Kuzu 库，统计 File、Symbol、关系、解析错误、符号分类与待同步变化数量。
- `src/sample.ts`：index 后从 Kuzu 抽查少量 Symbol 字段，作为和 status 同级的验证入口。
- `src/syncer.ts`：基于 contentHash 增量刷新已变更和已删除 Lua 文件。
- `src/query.ts`：按 `name`、`kind`、`callers`、`callees` 查询已索引图。
- `src/impact.ts`：基于 Calls 反向关系分析文件或符号的影响范围。
- `src/format.ts`：为 query/impact 提供 `json`、`table`、`tree` 输出。
- `src/server.ts`：内置 HTTP 服务，提供 `/api/status`、`/api/graph`、`/api/code` 和静态 Web UI。
- `src/init.ts`：初始化流程编排入口。
- `test/`：测试。

### Serve 第一版

```bash
luagraph serve [project_root] --port <port> --open
```

- `[project_root]` 默认当前目录；`--port` 不传时使用随机可用端口并输出实际 URL。
- `--open` 会用系统默认浏览器打开服务地址。
- 第一版展示 File/Symbol 节点与 Contains 关系，支持搜索高亮、邻居高亮和点击符号查看源码片段。
- 当前限制：只读取已完成 `init` 和 `index` 的本地图数据库；Web 以 File、Symbol、Contains 和源码片段为主；不承诺 v0.8 规划中的 upvalue、Requires、Extends 或动态 require 分析。

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
| Serve     | `submit/test-serve.sh`           | `npm run typecheck && npx vitest run test/server.test.ts test/web-assets.test.ts && npm run build`，临时 Lua 项目 `init/index/serve` 后检查 API 和静态资产 |
| Parser Accuracy | `submit/test-parser-accuracy.sh` | `npm run typecheck && npx vitest run test/parser.test.ts && npm run build`，验证解析准确性用例 |
| Sync Refresh | `submit/test-sync-refresh.sh` | `npm run typecheck && npx vitest run test/syncer.test.ts test/status.test.ts test/cli.test.ts test/indexer.test.ts && npm run build`，CLI 临时项目验证增量刷新、删除文件和 status |
| Query | `submit/test-query.sh` | `npm run typecheck && npx vitest run test/query.test.ts test/indexer.test.ts test/syncer.test.ts test/cli.test.ts && npm run build`，CLI 临时项目验证 name/kind/callers/callees 查询和 sync 后刷新 |
| Impact | `submit/test-impact.sh` | `npm run typecheck && npx vitest run test/format.test.ts test/impact.test.ts test/query.test.ts test/cli.test.ts && npm run build`，CLI 临时项目验证 query/impact 的 json/table/tree 输出 |

## Systems/ 分析（已完成 ✅）

对 18 个 Lua 文件的完整分析流程：

| 分支           | 状态    | 任务                        | 验收目标                              |
| -------------- | ------- | --------------------------- | ------------------------------------- |
| systems-scan   | 已完成  | 扫描 Systems/ 全部 Lua 文件 | scanner 输出 18 个文件路径            |
| systems-parse  | 已完成  | 索引符号写入 Kuzu           | parser 提取所有 class/function/method |
| systems-verify | 已完成  | 验证图数据完整性            | status 输出非零计数                   |
