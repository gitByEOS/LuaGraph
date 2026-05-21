# LuaGraph

## 项目架构

LuaGraph v0.8.0 是一个 TypeScript CLI/library，用于扫描 Lua 项目、提取可索引符号、调用关系、最小继承关系与 Lua require 文件依赖，并写入 Kuzu 图数据库。当前 CLI 覆盖 `init`、`status`、`index`、`sync`、`sample`、`query`、`impact` 和 `serve`，工具链使用 npm scripts 与 Vitest/TypeScript。

### 已完成模块

| 模块        | 文件                                       | 状态 |
| ----------- | ------------------------------------------ | ---- |
| CLI 入口    | `src/cli.ts`, `src/cli/*`                  | 已完成 |
| 公共出口    | `src/lib.ts`                               | 已完成 |
| Core 产品层 | `src/core/*`                               | 已完成 |
| AST 中间层  | `src/ast/types.ts`, `src/ast/registry.ts`  | 已完成 |
| Lua 适配器  | `src/ast/lua/*`                            | 已完成 |
| JS/TS 适配器 | `src/ast/js/*`                            | 已完成 |
| Web 服务    | `src/web/server.ts`, `src/web/assets/*`    | 已完成 |
| v0.4 解析准确性 | `src/ast/lua/parser.ts`, `test/parser.test.ts` | 已完成 (行级模式，含函数作用域结束行和调用提取) |
| v0.5 增量同步 | `src/core/syncer.ts`                    | 已完成 |
| v0.6 图查询 | `src/core/query.ts`                        | 已完成 |
| v0.7 影响分析 | `src/core/impact.ts`                    | 已完成 |
| v0.7 输出格式 | `src/cli/format.ts`                     | 已完成 (query/impact 的 json/table/tree) |
| v0.8 最小继承 | `src/ast/lua/parser.ts`, `src/ast/lua/extend-graph.ts`, `src/core/query.ts` | 已完成 (`setmetatable` 与 `class("X", Base)`) |
| v0.8 Requires | `src/ast/lua/parser.ts`, `src/ast/lua/require-graph.ts`, `src/core/query.ts`, `src/core/impact.ts` | 已完成最小闭环 (静态/动态 require、查询、反向影响) |

### 模块结构

- `src/cli.ts`：薄 CLI 入口，保持 `dist/cli.js` 产物路径不变。
- `src/cli/`：命令装配、浏览器打开和 query/impact 输出格式。
- `src/lib.ts`：公共库出口，聚合 core 与 AST 必要类型。
- `src/ast/types.ts`：语言无关中间表示，包含 `ParsedFile`、`ParsedSymbol`、`ParsedCall`、`ParsedExtend`、`ParsedRequire`。
- `src/ast/registry.ts`：语言适配器统一入口，按扩展名返回 Lua 或 JS/TS 适配器。
- `src/ast/lua/`：Lua 行级解析、Calls/Extends/Requires 关系重建与相关边删除。
- `src/ast/js/`：JS/TS 解析、Calls/Extends/Requires 关系重建与相关边删除。
- `src/core/`：配置、路径、扫描、初始化、索引、同步、查询、影响分析、状态、存储和代码片段读取。
- `src/core/project-types.ts`：配置、命令结果、查询节点、状态等产品层类型。
- `src/web/server.ts`：内置 HTTP 服务，提供 `/api/status`、`/api/graph`、`/api/code`。
- `src/web/assets/`：静态 Web UI 资产。
- `test/`：测试。

### Serve 第一版

```bash
luagraph serve [project_root] --port <port> --open
```

- `[project_root]` 默认当前目录；`--port` 不传时使用随机可用端口并输出实际 URL。
- `--open` 会用系统默认浏览器打开服务地址。
- 第一版展示 File/Symbol 节点与 Contains 关系，支持搜索高亮、邻居高亮和点击符号查看源码片段。
- 当前限制：只读取已完成 `init` 和 `index` 的本地图数据库；Web 展示 File、Symbol、Contains、Requires、Extends 和源码片段；不承诺 upvalue 分析。

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
| Extends | `submit/test-extends.sh` | `npm run typecheck && npx vitest run test/parser.test.ts test/indexer.test.ts test/syncer.test.ts test/query.test.ts test/format.test.ts && npm run build`，CLI 临时项目验证 Extends 查询 |
| Requires | `submit/test-requires.sh` | `npm run typecheck && npx vitest run test/parser.test.ts test/indexer.test.ts test/syncer.test.ts test/query.test.ts test/impact.test.ts test/cli.test.ts && npm run build`，CLI 临时项目验证 requires/dependents/impact |
| Layout | `submit/test-layout.sh` | `npm run typecheck && npx vitest run test/parser.test.ts test/indexer.test.ts test/syncer.test.ts test/query.test.ts test/server.test.ts test/web-assets.test.ts && npm run build`，验证目录分层后的公共入口、Lua 适配器和 Web 资产路径 |

## Systems/ 分析（已完成 ✅）

对 18 个 Lua 文件的完整分析流程：

| 分支           | 状态    | 任务                        | 验收目标                              |
| -------------- | ------- | --------------------------- | ------------------------------------- |
| systems-scan   | 已完成  | 扫描 Systems/ 全部 Lua 文件 | scanner 输出 18 个文件路径            |
| systems-parse  | 已完成  | 索引符号写入 Kuzu           | parser 提取所有 class/function/method |
| systems-verify | 已完成  | 验证图数据完整性            | status 输出非零计数                   |
