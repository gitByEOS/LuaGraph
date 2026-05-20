# LuaGraph

## 项目架构

LuaGraph v0.1.0 是一个 TypeScript CLI/library 骨架，工具链使用 Vite+ `vp`。

当前阶段只建立可扩展模块边界，不实现真实 `init` 业务写入：

- `src/cli.ts`：CLI 入口，预留 `luagraph init <project_root>` 命令。
- `src/lib.ts`：公共库出口。
- `src/types.ts`：v0.1.0 的配置、schema、路径和 init 类型。
- `src/config.ts`：配置读写校验，默认读取 `.gitignore` 生成 exclude。
- `src/path.ts`：Git 风格路径规范化和安全解析。
- `src/store.ts`：Kuzu schema 入口占位。
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
