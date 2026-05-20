# LuaGraph 使用指南

## 安装

```bash
pnpm install
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

### 2. 分析 Lua 符号

扫描指定模式的 Lua 文件，提取 class/function/method 符号并写入 Kuzu：

```bash
# 分析 Systems/ 目录（默认）
luagraph analyze /path/to/your/lua/project

# 自定义匹配模式
luagraph analyze /path/to/your/lua/project --include "src/**/*.lua"
luagraph analyze /path/to/your/lua/project --include "**/*.lua"
```

输出 JSON：
```json
{
  "fileCount": 18,
  "symbolCount": 42,
  "containsCount": 42,
  "databaseDir": "/path/to/.luagraph/kuzu"
}
```

### 3. 查看状态

查询 Kuzu 图数据库中已存储的 File、Symbol、关系数量：

```bash
luagraph status /path/to/your/lua/project
luagraph status --project-root /path/to/your/lua/project
```

输出 JSON：
```json
{
  "fileCount": 18,
  "symbolCount": 42,
  "edgeCount": 42,
  "databaseDir": "/path/to/.luagraph/kuzu",
  "configPath": "/path/to/.luagraph/config.json",
  "schemaCount": 8
}
```

### 4. 完整工作流示例

```bash
# 对 LuaGraph 项目自身的 Systems/ 做完整分析
cd /Users/bole/dev/mul-agents/LuaGraph/agents-hub

# 构建
pnpm run build

# 初始化
node dist/cli.js init /Users/bole/dev/mul-agents/LuaGraph

# 分析
node dist/cli.js analyze /Users/bole/dev/mul-agents/LuaGraph --include "Systems/**/*.lua"

# 验证
node dist/cli.js status /Users/bole/dev/mul-agents/LuaGraph
```

## 验证

### 运行全部测试

```bash
npx vitest run
```

预期输出：`32 passed`

### 按模块运行测试

```bash
npx vitest run test/analyze.test.ts    # 分析模块
npx vitest run test/scanner.test.ts    # 扫描模块
npx vitest run test/status.test.ts     # 状态模块
npx vitest run test/verify.test.ts     # 验证模块
```

### 运行验收脚本

```bash
submit/test-agent-init.sh      # 初始化验收
submit/test-agent-scanner.sh   # 扫描验收
submit/test-agent-status.sh    # 状态验收
submit/test-agent-parse.sh     # 分析验收
submit/test-agent-verify.sh    # 完整验证（CLI 方式）
```

### 快速验证（最快）

```bash
submit/test-agent-verify.sh
```

该脚本会依次执行：
1. `luagraph init` 初始化项目
2. `luagraph analyze` 分析 Systems/ 18 个 Lua 文件
3. `luagraph status` 验证计数
4. 自动检查 fileCount=18, symbolCount>0, edgeCount>0

## Kuzu 图数据库 Schema

| 节点/关系 | 说明 | 关键字段 |
|---|---|---|
| File | Lua 文件 | path, contentHash, size, modifiedAt |
| Symbol | 符号（class/function/method） | id, kind, name, qualifiedName, filePath, startLine |
| Contains | 文件→符号 | — |
| Calls | 符号→符号（调用） | line, column, isResolved |
| Requires | 文件→文件（依赖） | moduleName, isResolved |
| Extends | 符号→符号（继承） | — |

## Parser 当前支持的符号类型

| 类型 | Lua 模式 | kind |
|---|---|---|
| Class | `ClassName = class("ClassName"...)` | table |
| Method | `function Class:method()` | method |
| Function | `function foo()` | function |
| Local Function | `local function foo()` | function |

Phase 1 使用行级正则匹配，不读取 AST。后续可接入 `tree-sitter-lua` 实现完整语法树解析。
