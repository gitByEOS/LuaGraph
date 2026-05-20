# LuaGraph

## 项目架构

LuaGraph v0.1.0 是一个 TypeScript CLI/library 骨架，工具链使用 Vite+ `vp`。

当前阶段只建立可扩展模块边界，不实现真实 `init` 业务写入：

- `src/cli.ts`：CLI 入口，预留 `luagraph init <project_root>` 命令。
- `src/lib.ts`：公共库出口。
- `src/types.ts`：v0.1.0 的配置、schema、路径和 init 类型。
- `src/config.ts`：默认配置占位。
- `src/path.ts`：Git 风格路径规范化入口占位。
- `src/store.ts`：Kuzu schema 入口占位。
- `src/init.ts`：初始化流程编排入口占位。
- `test/`：最小测试，证明 `vp test` 可运行。

## 验收标准

在项目根目录运行：

```bash
submit/test-agent-init.sh
submit/test-agent-path.sh
```

脚本会从自身位置定位项目根，并依次执行：

`submit/test-agent-init.sh`：

```bash
vp install
vp test
vp check
```

`submit/test-agent-path.sh`：

```bash
vp test test/path.test.ts
vp check
```
