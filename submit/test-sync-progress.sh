#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMP_PROJECT="$(mktemp -d)"
SYNC_STDOUT="$(mktemp)"
SYNC_STDERR="$(mktemp)"

cleanup() {
  rm -rf "$TEMP_PROJECT"
  rm -f "$SYNC_STDOUT" "$SYNC_STDERR"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

npm run typecheck
npx vitest run test/syncer.test.ts test/cli.test.ts
npm run build

mkdir -p "$TEMP_PROJECT/src"
printf 'function before()\nend\n' > "$TEMP_PROJECT/src/player.lua"

node dist/cli.js init "$TEMP_PROJECT" > /dev/null
node dist/cli.js index "$TEMP_PROJECT" --quiet

printf 'function after()\nend\nfunction afterAgain()\nend\n' > "$TEMP_PROJECT/src/player.lua"

node dist/cli.js sync "$TEMP_PROJECT" --format json > "$SYNC_STDOUT" 2> "$SYNC_STDERR"

node -e '
const fs = require("node:fs");
const stdout = fs.readFileSync(process.argv[1], "utf8");
const stderr = fs.readFileSync(process.argv[2], "utf8");
const result = JSON.parse(stdout);

if (
  result.scannedFileCount !== 1 ||
  result.changedFileCount !== 1 ||
  result.removedFileCount !== 0 ||
  result.symbolCount !== 2 ||
  result.containsCount !== 2
) {
  throw new Error(`sync stdout 验收失败: ${JSON.stringify(result)}`);
}

for (const message of [
  "[sync] 开始扫描 Lua 文件",
  "[sync] 扫描到 1 个 Lua 文件",
  "[sync] 开始对比 contentHash",
  "[sync] 待刷新 1 个文件，待删除 0 个文件",
  "[sync] 同步文件[1/1] player.lua",
  "[sync] 开始重建 Calls",
  "[sync] 完成统计：扫描 1，刷新 1，删除 0，符号 2，Contains 2，Calls 0",
]) {
  if (!stderr.includes(message)) {
    throw new Error(`sync stderr 缺少进度: ${message}`);
  }
}
' "$SYNC_STDOUT" "$SYNC_STDERR"
