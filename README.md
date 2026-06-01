# LuaGraph

LuaGraph 是一个面向 Lua 项目的本地语义图谱工具。它扫描项目源码，提取文件、符号、调用、继承和 `require` 依赖关系，并将结果写入 Kuzu 图数据库，便于后续查询、影响分析和本地可视化。

项目同时提供 CLI 和 TypeScript library，适合用于 Lua 代码库的结构梳理、依赖追踪、变更影响评估和辅助审查。

## 功能特性

- 扫描 Lua 项目并维护 `.luagraph` 本地配置与数据库。
- 提取 `file`、`class`、`function`、`method` 等符号信息。
- 建立 `Contains`、`Calls`、`Extends`、`Requires` 等图关系。
- 支持基于内容哈希的增量同步。
- 支持按名称、类型、调用方、被调用方、继承关系和文件依赖查询。
- 支持文件或符号级影响分析。
- 支持源码片段读取和本地 Web 可视化服务。
- 提供 JS/TS 适配器，用于统一 AST 中间表示与跨语言测试。

## 项目测试

LuaGraph 最初用于验证公司项目接入 Agent 时的 code-map 支持方案，目标是通过预先构建代码图谱来减少 Agent 理解项目所需的 token 消耗，以及新会话每次都重新理解代码内容的问题。

经过多维度实验后，当前结论是：code-map 并不能节省 token。Agent 在使用图谱结果时仍会反复读取源码、交叉验证置信度，整体执行速度反而更慢。因此本项目已暂停继续投入。

后续方向已转为外挂记忆图谱方案，详见 [MemoryGraph Skill](https://github.com/gitByEOS/open-part-skills/blob/main/skills/memory-graph/SKILL.md)。

## 安装

```bash
pnpm install
pnpm run build
```

构建完成后可以直接执行产物：

```bash
node dist/cli.js --help
```

发布或全局安装后，CLI 命令为：

```bash
luagraph --help
```

## 快速开始

在目标 Lua 项目中初始化 LuaGraph：

```bash
luagraph init /path/to/lua-project
```

建立完整索引：

```bash
luagraph index /path/to/lua-project
```

查看项目状态：

```bash
luagraph status /path/to/lua-project
```

源码变更后执行增量同步：

```bash
luagraph sync /path/to/lua-project
```

查询符号或关系：

```bash
luagraph query name:ThemeCollectDialog --project-root /path/to/lua-project --format table
luagraph query callers:ThemeCollectDialog --project-root /path/to/lua-project --depth 2 --format tree
luagraph query requires:src/main.lua --project-root /path/to/lua-project --format json
```

分析变更影响范围：

```bash
luagraph impact ThemeCollectDialog --project-root /path/to/lua-project --depth 2 --format tree
luagraph impact Diner/DinerDialogs.lua --project-root /path/to/lua-project --format json
```

启动本地可视化服务：

```bash
luagraph serve /path/to/lua-project --port 3000 --open
```

## CLI 命令

`init` 初始化项目配置和本地图数据库。

`status` 输出文件数、符号数、边数、解析错误数和待同步变更数。

`index` 扫描项目并重建索引，支持 `--force`、`--quiet` 和 `--format`。

`sync` 基于内容哈希刷新新增、修改和删除的文件。

`sample` 抽样输出已索引符号，便于快速检查解析结果。

`query` 查询图数据，支持 `name:`、`kind:`、`callers:`、`callees:`、`extends:`、`subclasses:`、`requires:`、`dependents:` 和 `methods:`。

`impact` 从文件或符号出发，沿反向调用和反向依赖关系分析影响范围。

`explain` 从文件或符号出发解释入口、调用流、分支、依赖和外部缺口。

`serve` 启动本地 HTTP 服务，提供状态、图数据和源码片段接口。

## Library 用法

LuaGraph 的公共 API 由 `src/lib.ts` 导出。构建后可在 TypeScript 项目中复用核心能力：

```ts
import { indexProject, queryProject } from "luagraph";

await indexProject("/path/to/lua-project", { force: true });

const queryResult = await queryProject("/path/to/lua-project", "kind:class", {
  depth: 1,
});
```

## 项目结构

- `src/cli.ts`：CLI 入口。
- `src/cli/`：命令装配、浏览器打开和输出格式化。
- `src/lib.ts`：公共 library 出口。
- `src/ast/types.ts`：语言无关的 AST 中间表示。
- `src/ast/registry.ts`：语言适配器注册入口。
- `src/ast/lua/`：Lua 解析、调用关系、继承关系和 `require` 关系重建。
- `src/ast/js/`：JS/TS 解析适配器。
- `src/core/`：配置、路径、扫描、初始化、索引、同步、查询、影响分析和存储。
- `src/web/`：本地 Web 服务和静态资源。
- `test/`：单元测试和 CLI 行为测试。

## 开发验证

```bash
pnpm run typecheck
pnpm exec vitest run
pnpm run build
```

也可以执行 `submit/` 下的验收脚本，对具体 CLI 场景进行验证。

## 数据存储

LuaGraph 会在目标项目下创建 `.luagraph` 目录，用于保存配置和 Kuzu 数据库。索引数据只写入本地项目目录，不依赖远程服务。

## 当前边界

- Lua 解析以静态源码分析为主，不执行目标项目代码。
- `require` 关系覆盖静态字符串和可识别的动态路径模式。
- 调用关系、继承关系和影响分析依赖当前索引结果，源码变更后需要执行 `sync` 或重新 `index`。

## 开源协议

[MIT](LICENSE)。