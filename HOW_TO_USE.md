# LuaGraph 使用指南

## 安装

```bash
# 1. 安装依赖
pnpm install

# 2. 构建（每次合并新代码后必须执行）
pnpm run build

# 3. 全局安装（可选，否则用 node dist/cli.js 代替 luagraph）
pnpm link --global
```

未全局安装时，所有 `luagraph` 命令改用 `node dist/cli.js`：

```bash
node dist/cli.js init <path>        # 代替 luagraph init
node dist/cli.js status             # 代替 luagraph status，默认当前目录
node dist/cli.js status <path>      # 显式查看指定项目
node dist/cli.js index <path>       # 代替 luagraph index
node dist/cli.js sync <path>        # 代替 luagraph sync
node dist/cli.js sample             # 代替 luagraph sample，默认当前目录
node dist/cli.js sample <path>      # index 后抽查指定项目
node dist/cli.js query name:init    # 代替 luagraph query
node dist/cli.js impact init        # 代替 luagraph impact
node dist/cli.js serve <path>       # 启动本地可视化服务
```

## 使用方式

### 1. 初始化项目

在目标 Lua 项目根目录初始化 LuaGraph 配置和图数据库：

```bash
# 方式 1：直接指定路径
luagraph init /path/to/your/lua/project

# 方式 2：相对路径
cd /path/to/your/lua/project
luagraph init .
```

会创建：
- `.luagraph/config.json` — 扫描配置（include/exclude 规则）
- `.luagraph/kuzu/` — Kuzu 图数据库目录

### 2. 索引 Lua 符号

扫描指定模式的 Lua 文件，提取 class/table/function/method 符号、可解析 Calls 关系和确定的 Extends 关系并写入 Kuzu：

```bash
# 索引目标项目
luagraph index /path/to/your/lua/project

# 强制重建并输出 JSON
luagraph index /path/to/your/lua/project --force --format json
```

输出 JSON：
```json
{
  "fileCount": 18,
  "symbolCount": 42,
  "containsCount": 42,
  "callsCount": 12,
  "databaseDir": "/path/to/.luagraph/kuzu"
}
```

### 3. 增量刷新索引

`sync` 基于 contentHash 处理新增、变更和删除的 Lua 文件，并刷新相关 Symbol、Contains、Calls 和 Extends 数据。无参数时默认使用当前目录：

```bash
luagraph sync
luagraph sync /path/to/your/lua/project --format json
luagraph sync /path/to/your/lua/project --format table
luagraph sync /path/to/your/lua/project --quiet
```

输出 JSON：
```json
{
  "scannedFileCount": 18,
  "changedFileCount": 2,
  "removedFileCount": 1,
  "symbolCount": 41,
  "containsCount": 41,
  "databaseDir": "/path/to/.luagraph/kuzu"
}
```

### 4. 抽查索引结果

`sample` 和 `status` 同级，用于 index 后从 Kuzu 抽查少量 Symbol 数据，不读取源码、不做 dump、不做可视化。无参数时默认使用当前目录：

```bash
luagraph sample
luagraph sample /path/to/your/lua/project --limit 20 --format json
luagraph sample /path/to/your/lua/project --format table
```

输出 JSON：
```json
{
  "projectRoot": "/path/to/your/lua/project",
  "count": 2,
  "symbols": [
    {
      "kind": "table",
      "name": "Player",
      "qualifiedName": "Player",
      "filePath": "src/player.lua",
      "startLine": 1,
      "isLocal": false,
      "signature": "Player = class(\"Player\")"
    }
  ]
}
```

### 5. 查看状态

查询 Kuzu 图数据库中已存储的 File、Symbol、关系、解析错误、符号分类和待同步变化数量。无参数时默认使用当前目录：

```bash
luagraph status
luagraph status /path/to/your/lua/project
luagraph status --project-root /path/to/your/lua/project
```

输出 JSON：
```json
{
  "fileCount": 18,
  "symbolCount": 42,
  "edgeCount": 42,
  "parseErrorCount": 0,
  "symbolKindCounts": {
    "function": 10,
    "method": 14,
    "table": 18
  },
  "pendingSyncChangeCount": 0,
  "databaseDir": "/path/to/.luagraph/kuzu",
  "configPath": "/path/to/.luagraph/config.json",
  "schemaCount": 8
}
```

### 6. 查询图数据

`query` 读取已索引图，支持按名称、类型、Calls 和 Extends 关系查询。表达式可以组合普通过滤条件；关系条件一次只使用一个：

```bash
luagraph query name:init
luagraph query kind:function
luagraph query kind:file
luagraph query callers:init --depth 2
luagraph query callees:init --format tree
luagraph query extends:Child --format table
luagraph query subclasses:Base --depth 2 --format tree
luagraph query name:init --project-root /path/to/your/lua/project --format table
```

支持的输出格式：
- `json`：结构化结果，包含 `nodes` 和 `edges`，Extends 边会以 `kind: "Extends"` 输出。
- `table`：逐行输出匹配节点，便于终端阅读。
- `tree`：按 callers/callees/extends/subclasses 关系展示层级，循环节点会标记 `(cycle)`。

### 7. 分析影响范围

`impact` 基于 Calls 反向关系分析调用者影响范围。输入可以是文件路径、符号名或 qualifiedName：

```bash
luagraph impact src/api.lua
luagraph impact leaf --depth 1
luagraph impact leaf --format json
luagraph impact leaf --format table
luagraph impact leaf --format tree
luagraph impact leaf --project-root /path/to/your/lua/project
```

支持的输出格式：
- `json`：结构化结果，包含种子符号、受影响符号、文件列表和 Calls 边。
- `table`：分段列出 seeds、affected 和 files。
- `tree`：从输入符号向调用者方向展示影响链。

### 8. 启动本地可视化

`serve` 会启动内置 HTTP 服务，读取已索引的 Kuzu 图数据库并提供静态 Web UI：

```bash
luagraph serve
luagraph serve /path/to/your/lua/project
luagraph serve /path/to/your/lua/project --port 43210
luagraph serve /path/to/your/lua/project --open
```

不传 `--port` 时默认使用随机可用端口，并在终端输出实际 URL。未全局安装时：

```bash
node dist/cli.js serve /path/to/your/lua/project --port 43210 --open
```

第一版能力：
- 展示 File、Symbol 节点和 Contains 关系。
- 搜索命中节点高亮，并保留相邻节点帮助定位结构。
- 点击 Symbol 节点后通过 `/api/code` 读取源码片段。

当前限制：
- 需要先执行 `init` 和 `index`，索引刷新由 CLI `sync` 执行。
- Web 仍以 File、Symbol、Contains 和源码片段为主。
- Extends 仅识别确定的 `Child = setmetatable({}, { __index = Parent })` 和 `local Child = ...` 模式。
- 不承诺 upvalue、Requires 或动态 require 分析。
- 不提供前端构建链，不监听文件变化。

### 9. 完整工作流示例

```bash
# 进入 LuaGraph 项目根
cd /path/to/luagraph

# 构建
pnpm run build

# 初始化
node dist/cli.js init .

# 索引
node dist/cli.js index . --force --format json

# 增量刷新
node dist/cli.js sync . --format table

# 验证当前目录
node dist/cli.js sample
node dist/cli.js status
node dist/cli.js query callers:init --depth 2 --format tree
node dist/cli.js impact init --format table

# 查看可视化
node dist/cli.js serve . --open
```

## 验证

### 运行全部测试

```bash
npx vitest run
```

预期输出以当前测试集为准，所有用例应通过。

### 按模块运行测试

```bash
npx vitest run test/indexer.test.ts    # 索引模块
npx vitest run test/scanner.test.ts    # 扫描模块
npx vitest run test/status.test.ts     # 状态模块
npx vitest run test/sample.test.ts     # 抽查模块
npx vitest run test/syncer.test.ts     # 增量同步模块
npx vitest run test/query.test.ts      # 查询模块
npx vitest run test/impact.test.ts     # 影响分析模块
npx vitest run test/format.test.ts     # 输出格式模块
npx vitest run test/verify.test.ts     # 验证模块
```

### 运行验收脚本

```bash
submit/test-agent-init.sh      # 初始化验收
submit/test-agent-scanner.sh   # 扫描验收
submit/test-agent-status.sh    # 状态验收
submit/test-index.sh           # 索引验收
submit/test-agent-verify.sh    # 完整验证（CLI 方式）
submit/test-status-accuracy.sh # status 准确性验收
submit/test-sample.sh          # sample 抽查验收
submit/test-serve.sh           # serve API 和静态 UI 验收
submit/test-parser-accuracy.sh # parser 准确性验收
submit/test-sync-refresh.sh    # sync 增量刷新验收
submit/test-query.sh           # query 查询验收
submit/test-impact.sh          # impact 与格式验收
submit/test-extends.sh         # Extends 最小闭环验收
```

### 快速验证（最快）

```bash
submit/test-agent-verify.sh
```

该脚本会依次执行：
1. `luagraph init` 初始化项目
2. `luagraph index` 索引 Lua 文件
3. `luagraph status` 验证计数
4. 自动检查 fileCount、symbolCount、edgeCount

## Kuzu 图数据库 Schema

| 节点/关系 | 说明 | 关键字段 |
|---|---|---|
| File | Lua 文件 | path, contentHash, size, modifiedAt |
| Symbol | 符号（class/table/function/method） | id, kind, name, qualifiedName, filePath, startLine |
| Contains | 文件→符号 | — |
| Calls | 符号→符号（调用） | line, column, isResolved |
| Requires | schema 预留关系表，当前解析流程不写入 | moduleName, isResolved |
| Extends | 符号→父级符号（最小继承） | — |

## Parser 当前支持的符号类型

| 类型 | Lua 模式 | kind |
|---|---|---|
| Class | `ClassName = class("ClassName"...)` | class |
| Table | `TableName = {` 或 `TableName =` | table |
| Method | `function Class:method()` | method |
| Dot Method | `function Module.func()` | method |
| Function | `function foo()` | function |
| Local Function | `local function foo()` | function |

Parser 使用行级模式，不读取 AST。Extends 仅识别 `Child = setmetatable({}, { __index = Parent })` 与 `local Child = ...` 的确定符号关系；`T.__index = T` 和动态 parent 表达式不会生成确定继承边。当前不承诺 upvalue、Requires 或动态 require 分析。
