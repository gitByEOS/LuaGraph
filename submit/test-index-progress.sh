#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-index-progress.XXXXXX")"
INDEX_STDOUT="$TEMP_PROJECT/index.stdout.json"
INDEX_STDERR="$TEMP_PROJECT/index.stderr.log"
STATUS_STDOUT="$TEMP_PROJECT/status.stdout.json"
SAMPLE_STDOUT="$TEMP_PROJECT/sample.stdout.json"

cleanup() {
  rm -rf "$TEMP_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

echo "1. Build CLI"
npm run build

echo "2. Prepare Lua project"
mkdir -p "$TEMP_PROJECT/src"
cat > "$TEMP_PROJECT/src/player.lua" <<'LUA'
Player = class("Player")
function Player:move()
end
LUA

node "$PROJECT_DIR/dist/cli.js" init "$TEMP_PROJECT" >/dev/null

echo "3. Verify index progress and JSON stdout"
node "$PROJECT_DIR/dist/cli.js" index "$TEMP_PROJECT" --force --format json >"$INDEX_STDOUT" 2>"$INDEX_STDERR"

node - "$INDEX_STDOUT" <<'NODE'
const { readFileSync } = require("node:fs");

const result = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (result.fileCount !== 1 || result.symbolCount !== 2 || result.containsCount !== 2) {
  console.error(`索引结果不符合预期: ${JSON.stringify(result)}`);
  process.exit(1);
}
NODE

node - "$INDEX_STDERR" <<'NODE'
const { readFileSync } = require("node:fs");

const progress = readFileSync(process.argv[2], "utf8");
const expectedMessages = [
  "开始扫描 Lua 文件",
  "扫描到 1 个 Lua 文件",
  "开始索引 Lua 符号",
  "已索引 1/1 个 Lua 文件",
  "完成统计：文件 1，符号 2，Contains 2",
];

for (const message of expectedMessages) {
  if (!progress.includes(message)) {
    console.error(`缺少进度输出: ${message}`);
    process.exit(1);
  }
}
NODE

echo "4. Verify status and sample class kind"
node "$PROJECT_DIR/dist/cli.js" status "$TEMP_PROJECT" >"$STATUS_STDOUT"
node "$PROJECT_DIR/dist/cli.js" sample "$TEMP_PROJECT" --limit 2 --format json >"$SAMPLE_STDOUT"

node - "$STATUS_STDOUT" "$SAMPLE_STDOUT" <<'NODE'
const { readFileSync } = require("node:fs");

const status = JSON.parse(readFileSync(process.argv[2], "utf8"));
const sample = JSON.parse(readFileSync(process.argv[3], "utf8"));
const firstSymbol = sample.symbols[0];

if (status.symbolKindCounts.class !== 1 || status.symbolKindCounts.method !== 1) {
  console.error(`状态统计未识别 class: ${JSON.stringify(status.symbolKindCounts)}`);
  process.exit(1);
}

if (!firstSymbol || firstSymbol.kind !== "class" || firstSymbol.qualifiedName !== "Player") {
  console.error(`抽样结果未识别 class: ${JSON.stringify(sample.symbols)}`);
  process.exit(1);
}
NODE

echo "test-index-progress passed"
