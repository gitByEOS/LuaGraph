# Subagent Explain 复测流程

## 目标

验证 Subagent 是否能在临时项目中，通过完整 `src`、`.luagraph`、`HOW_TO_USE.md` 和 `luagraph` CLI 理解目标文件逻辑。

## 准备临时项目

```bash
cd /Users/bole/dev/mul-agents/LuaGraph/master
npm run build

TEMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-full-src-explain.XXXXXX")"
cp -R src "$TEMP_PROJECT/src"
cp docs/HOW_TO_USE.md "$TEMP_PROJECT/HOW_TO_USE.md"

node dist/cli.js init "$TEMP_PROJECT" >/dev/null
node dist/cli.js index "$TEMP_PROJECT" --force --format json

echo "$TEMP_PROJECT"
```

## 主 Agent 预检

```bash
node dist/cli.js status "$TEMP_PROJECT"

node dist/cli.js explain src/core/query.ts \
  --project-root "$TEMP_PROJECT" \
  --format text
```

合格标准：

- `parseErrorCount` 为 `0`。
- `pendingSyncChangeCount` 为 `0`。
- `explain` 能输出 `External Contracts`。

## Subagent 限制

派发说明中写清楚：

```text
不要修改文件，不要创建分支，不要提交。

只在临时目录内工作：<TEMP_PROJECT>
禁止读取 /Users/bole/dev/mul-agents/LuaGraph/master 下任何源码文件。

允许读取：
- <TEMP_PROJECT>/HOW_TO_USE.md
- <TEMP_PROJECT>/.luagraph/config.json
- 必要时读取 <TEMP_PROJECT>/src 下源码核对 explain 结果

允许运行：
- node /Users/bole/dev/mul-agents/LuaGraph/master/dist/cli.js status <TEMP_PROJECT>
- node /Users/bole/dev/mul-agents/LuaGraph/master/dist/cli.js sample <TEMP_PROJECT>
- node /Users/bole/dev/mul-agents/LuaGraph/master/dist/cli.js query ... --project-root <TEMP_PROJECT>
- node /Users/bole/dev/mul-agents/LuaGraph/master/dist/cli.js impact ... --project-root <TEMP_PROJECT>
- node /Users/bole/dev/mul-agents/LuaGraph/master/dist/cli.js explain ... --project-root <TEMP_PROJECT>
```

## Subagent 必跑命令

```bash
node /Users/bole/dev/mul-agents/LuaGraph/master/dist/cli.js status "<TEMP_PROJECT>"

node /Users/bole/dev/mul-agents/LuaGraph/master/dist/cli.js explain src/core/query.ts \
  --project-root "<TEMP_PROJECT>" \
  --format text

node /Users/bole/dev/mul-agents/LuaGraph/master/dist/cli.js query requires:* \
  --project-root "<TEMP_PROJECT>" \
  --format json

node /Users/bole/dev/mul-agents/LuaGraph/master/dist/cli.js query callees:queryProject \
  --project-root "<TEMP_PROJECT>" \
  --depth 2 \
  --format tree

node /Users/bole/dev/mul-agents/LuaGraph/master/dist/cli.js explain src/core/config.ts \
  --project-root "<TEMP_PROJECT>" \
  --format text

node /Users/bole/dev/mul-agents/LuaGraph/master/dist/cli.js explain src/core/store.ts \
  --project-root "<TEMP_PROJECT>" \
  --format text
```

## 报告模板

```text
# 完整 src Explain 复测报告

## 测试材料

## 相比软链单文件改善了什么

## 现在能理解到什么

## 仍不能理解的原因

## 当前输出仍有的问题

## 建议下一步改进
```

## 本轮结论

完整复制 `src` 后，Subagent 能通过 CLI 和必要单文件查看理解 `queryProject` 的完整主链路。

当前不足：

- TS 文件输入的 `Entry Points` 会保留低入度函数，信息量足但噪音仍偏高。
- `External Contracts` 仍只展示模块级依赖和跨文件调用，还没完整展示具名导入符号。
- `Data Flow` 是目标函数的源码摘要，不是完整 SSA/变量级跨函数数据流。
- file 输入现在输出 `Top Method Flow`，用于挑选下一步应 explain 的函数或方法。
