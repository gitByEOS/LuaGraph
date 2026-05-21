# LuaGraph 使用手册

## 运行入口

```bash
pnpm install                         # 安装依赖，含 tree-sitter 和 Kuzu。
pnpm run build                       # 生成 dist/cli.js 和 Web 静态资源。
pnpm link --global                   # 可选：把 luagraph 注册到全局命令。
node dist/cli.js <cmd>               # 未 link 时使用本地 CLI。
```

## 项目初始化

```bash
luagraph init <project>              # 写入 <project>/.luagraph/config.json。
luagraph init .                      # 当前目录作为 LuaGraph 项目根。
```

`.luagraph/config.json` 控制扫描范围：`include` 默认 `**/*.lua`、`**/*.js`、`**/*.jsx`、`**/*.ts`、`**/*.tsx`，`exclude` 默认跳过 `.luagraph/**`、`**/*.d.ts`、`node_modules/`、`dist/`、`build/`、`coverage/`、`.next/`、`.vite/`。

`.luagraph/kuzu/` 保存图数据库；删除后需重新 `index`。

## 索引与刷新

```bash
luagraph index <project> --force     # 删除旧库并重建 File、Symbol、Contains、Calls、Extends、Requires。
luagraph index <project> --quiet     # 只执行索引，不输出进度。
luagraph sync <project>              # 按 contentHash 刷新增、修改、删除的源码文件。
luagraph status <project>            # 输出节点数、关系数、分类计数、待同步数量。
luagraph sample <project> --limit 20 # 抽查已写入 Kuzu 的 Symbol。
```

`index` 和 `sync` 的 `requiresCount` 是写入的 require 表达式数，不等于已解析文件边数。

`Requires.isResolved=false` 表示目标文件未在当前项目扫描范围内，常见原因是外部库、缺文件、模块名动态拼接。

## 查询语法

```bash
luagraph query name:init                         # 精确匹配 symbol.name 或 symbol.qualifiedName。
luagraph query kind:class                        # 查询指定 Symbol kind；kind:file 查询 File。
luagraph query callers:init --depth 2            # 反向 Calls：谁调用 init。
luagraph query callees:init --format tree        # 正向 Calls：init 调用了谁。
luagraph query extends:Child                     # 正向 Extends：Child 的父级。
luagraph query subclasses:Base --depth 2         # 反向 Extends：Base 的子类。
luagraph query requires:main --format table      # 正向 Requires：main 匹配文件 require 了谁。
luagraph query dependents:utils --format table   # 反向 Requires：谁 require 了 utils 匹配文件。
luagraph query requires:* --format table         # 输出全部 Requires 边。
luagraph query extends:* --format table          # 输出全部 Extends 边。
```

一个 query 表达式只能包含一个关系条件：`callers`、`callees`、`extends`、`subclasses`、`requires`、`dependents`。

`--format json` 输出 `nodes` 和 `edges`，适合排查建边字段。

`--format table` 输出终端表格；`requires:*` 会显示 `Requiring File`、`Required File`、`Module`、`Resolved`。

`--format tree` 按关系层级展开，环路节点标记 `(cycle)`。

## 影响分析

```bash
luagraph impact src/api.lua --format table       # 文件输入：沿反向 Requires 找依赖文件。
luagraph impact init --depth 2 --format tree     # 符号输入：沿反向 Calls 找调用者。
luagraph impact Module.method --format json      # qualifiedName 输入：输出 seeds、nodes、files、edges。
```

`impact` 的文件影响来自 `Requires`，符号影响来自 `Calls`。

## 语义解释

```bash
luagraph explain src/core/query.ts --format text              # 解释文件入口、调用流、分支和依赖。
luagraph explain queryProject --depth 2 --format json         # 解释符号链路并输出机器可读 JSON。
luagraph explain src/main.lua --project-root /path/to/project # 指定项目根目录。
```

`explain` 按需读取目标单文件源码和已索引图数据，不写回 `.luagraph`。

`--format text` 固定输出 Markdown 模板，面向 CLI 证据和可执行命令：

```markdown
# Explain: src/main.lua

## Overview
- file: src/main.lua
- symbols: 3
- calls: 2
- requires: 1

## Entry Points
- main
  - reason: low-inbound
  - line: 3
  - commands:
    - luagraph explain main --depth 2
    - luagraph query callees:main --depth 2 --format tree
```

`--format json` 保留 `target`、`entrypoints`、`flow`、`branches`、`dependencies`、`dataFlow`、`externalGaps` 字段，适合脚本消费。

## 可视化服务

```bash
luagraph serve <project>                         # 启动本地 Web，端口随机。
luagraph serve <project> --port 43210            # 固定端口。
luagraph serve <project> --open                  # 启动后打开浏览器。
```

Web 只读取已索引 Kuzu；源码变更后先跑 `sync`。

Web 展示 File、Symbol、Contains、Extends、Requires；点击 Symbol 通过 `/api/code` 读取源码片段。

## 图模型

| 类型 | 方向 | 关键字段 |
|---|---|---|
| File | 节点 | path, contentHash, size, modifiedAt |
| Symbol | 节点 | id, kind, name, qualifiedName, filePath, startLine |
| Contains | File -> Symbol | 无业务字段 |
| Calls | Symbol -> Symbol | line, column, isResolved |
| Extends | Symbol -> Symbol | source=子类, target=父级 |
| Requires | File -> File | moduleName, isResolved |

## Lua 解析范围

| 能力 | 识别模式 |
|---|---|
| class | `ClassName = class("ClassName", Parent)` |
| table | 根级 `TableName = {}` |
| function | `function foo()`、`local function foo()` |
| method | `function Class:method()`、`function Module.func()` |
| extends | `class(..., Parent)`、`setmetatable({}, { __index = Parent })` |
| requires | `require("a.b")`、`require 'a.b'`、`require [[a.b]]`、动态表达式 |

Parser 基于 tree-sitter-lua；动态 require 会保留表达式并写出 `isResolved=false`。

路径解析支持 `a.b`、`a/b`、`a.b.lua`、同目录模块、去掉首段别名前缀后的项目内匹配。

不支持 upvalue 数据流、运行时 class 工厂、动态 parent 表达式、动态 require 目标解析。

## JS/TS 解析范围

| 能力 | 识别模式 |
|---|---|
| class | `class Name {}`、`export class Name {}` |
| function | `function foo()`、`export function foo()`、函数表达式或箭头函数变量 |
| method | class 内方法，qualifiedName 为 `Class.method` |
| extends | `class Child extends Parent` |
| requires | 静态 `import`、`export ... from`、`require("...")`、`import("...")` |

JS/TS 使用同一个 `jsAdapter`，扫描 `.js`、`.jsx`、`.ts`、`.tsx`，不扫描 `.d.ts`。

路径解析支持相对路径、扩展名省略、目录 `index.ts/index.tsx/index.js/index.jsx`、`tsconfig.json`/`jsconfig.json` 的 `compilerOptions.baseUrl` 与 `paths`。TypeScript 源码中写出的 `.js`/`.jsx` ESM import 会优先匹配真实 `.js`/`.jsx`，也会回退匹配同名 `.ts`/`.tsx` 源文件。

不解析类型专用 import/export，不跟踪变量别名、类型系统、运行时动态模块名和跨包 `node_modules` 依赖。

## 验证命令

```bash
npm run typecheck                   # TypeScript 类型检查。
npx vitest run                      # 全量单测。
submit/test-tree-sitter-lua.sh      # tree-sitter 解析和运行时 import 验收。
submit/test-core-multilang.sh       # 默认多语言扫描范围与 Lua 基线验收。
submit/test-js-ast.sh               # JS/TS AST adapter 单测验收。
submit/test-js-ts-art.sh            # 当前项目 JS/TS 全链路索引、查询、影响分析验收。
submit/test-query.sh                # query 查询验收。
submit/test-requires.sh             # Requires 最小闭环验收。
submit/test-extends.sh              # Extends 最小闭环验收。
submit/test-sync-refresh.sh         # sync 增量刷新验收。
submit/test-explain-cli.sh          # explain CLI text/json 端到端验收。
```
