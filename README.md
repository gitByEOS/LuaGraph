# LuaGraph

## 项目架构

LuaGraph v0.1.0 是一个 TypeScript CLI/library 骨架，工具链使用 Vite+ `vp`。

当前阶段只建立可扩展模块边界，不实现真实 `init` 业务写入：

- `src/cli.ts`：CLI 入口，预留 `luagraph init <project_root>` 命令。
- `src/lib.ts`：公共库出口。
- `src/types.ts`：配置、schema、路径、init、扫描器和状态类型。
- `src/config.ts`：配置读写校验，默认读取 `.gitignore` 生成 exclude。
- `src/path.ts`：Git 风格路径规范化和安全解析。
- `src/store.ts`：Kuzu schema 入口占位。
- `src/scanner.ts`：按配置扫描 Lua 文件并返回仓库相对路径。
- `src/parser.ts`：Phase 1 Lua 符号最小提取，输出 File 与 Symbol 结构。
- `src/status.ts`：读取项目配置和 Kuzu 库，统计 File、Symbol 与关系数量。
- `src/init.ts`：初始化流程编排入口占位。
- `test/`：最小测试，证明 `vp test` 可运行。

## 验收标准

在项目根目录运行：

```bash
submit/test-agent-init.sh
submit/test-agent-path.sh
submit/test-agent-config.sh
```

`submit/test-agent-init.sh` 会从自身位置定位项目根，并依次执行：

```bash
vp install
vp test
vp check
```

`submit/test-agent-path.sh` 会从自身位置定位项目根，并依次执行：

```bash
vp test test/path.test.ts
vp check
```

配置模块验收：

```bash
submit/test-agent-config.sh
```

`submit/test-agent-config.sh` 会从自身位置定位项目根，并依次执行：

```bash
vp test test/config.test.ts
vp check
```

Store 模块验收：

```bash
submit/test-agent-store.sh
```

`submit/test-agent-store.sh` 会从自身位置定位项目根，并依次执行：

```bash
vp install
vp test test/store.test.ts
vp check
```

Scanner 模块验收：

```bash
submit/test-agent-scanner.sh
```

`submit/test-agent-scanner.sh` 会从自身位置定位项目根，并依次执行：

```bash
vp test test/scanner.test.ts
vp check
```

Parser 模块验收：

```bash
submit/test-agent-parser.sh
```

`src/parser.ts` 当前是 Phase 1 最小提取：使用行级模式识别 `ClassName = class("ClassName"...)`、`function A:B()`、`function foo()` 和 `local function foo()`，生成稳定 id：`<path>#<kind>#<qualifiedName>#<startLine>:<startColumn>`。它不读取业务 `Systems` 代码，不写数据库，也不伪装完整 AST；后续接入 `tree-sitter`/`tree-sitter-lua` 时再扩展完整语法树提取。

`submit/test-agent-parser.sh` 会从自身位置定位项目根，并依次执行：

```bash
vp test test/parser.test.ts
vp check
```

init-real 验收：

```bash
submit/test-agent-init-real.sh
```

`submit/test-agent-init-real.sh` 会从自身位置定位项目根，并依次执行：

```bash
vp install
vp test
vp check
vp run build
```

随后脚本会在临时目录执行：

```bash
node dist/cli.js init <tmp>
```

并验证 `<tmp>/.luagraph/config.json` 与 `<tmp>/.luagraph/kuzu` 已创建。

status 验收：

```bash
submit/test-agent-status.sh
```

`submit/test-agent-status.sh` 会从自身位置定位项目根，并依次执行：

```bash
vp test test/status.test.ts
vp check
vp run build
```

CLI 支持以下两种 status 调用方式：

```bash
luagraph status <project_root>
luagraph status --project-root <path>
```
