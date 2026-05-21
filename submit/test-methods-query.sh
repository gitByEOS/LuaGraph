#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-methods-query.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

echo "1. Build"
npm run build

echo "2. Prepare Lua/TS fixture"
mkdir -p "$TEMP_PROJECT/src"

cat > "$TEMP_PROJECT/src/slots.lua" <<'LUA'
SlotsControl = {}

function SlotsControl:oncmd()
end

function SlotsControl:requestSpinData()
end

function SlotsControl.stop()
end

OtherControl = {}

function OtherControl:oncmd()
end
LUA

cat > "$TEMP_PROJECT/src/query-runner.ts" <<'TS'
class QueryRunner {
  run() {}

  execute() {}
}

class OtherRunner {
  run() {}
}
TS

echo "3. Init + index"
node "$PROJECT_DIR/dist/cli.js" init "$TEMP_PROJECT" >/dev/null
node "$PROJECT_DIR/dist/cli.js" index "$TEMP_PROJECT" --force --format json >/dev/null

echo "4. Query methods"
LUA_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query methods:SlotsControl --format json)"
LUA_TABLE="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query methods:SlotsControl --format table)"
LUA_TREE="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query methods:SlotsControl --format tree)"
TS_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query methods:QueryRunner --format json)"
TS_TABLE="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query methods:QueryRunner --format table)"

node -e '
const luaJson = JSON.parse(process.argv[1]);
const luaTable = process.argv[2];
const luaTree = process.argv[3];
const tsJson = JSON.parse(process.argv[4]);
const tsTable = process.argv[5];
const fail = (reason) => {
  console.error(`methods query 验收失败: ${reason}`);
  console.error(JSON.stringify({ luaJson, luaTable, luaTree, tsJson, tsTable }, null, 2));
  process.exit(1);
};
const luaNames = luaJson.nodes.map((node) => node.qualifiedName);
const tsNames = tsJson.nodes.map((node) => node.qualifiedName);

for (const expected of ["SlotsControl:oncmd", "SlotsControl:requestSpinData", "SlotsControl.stop"]) {
  if (!luaNames.includes(expected)) {
    fail(`Lua 缺少 ${expected}`);
  }
  if (!luaTable.includes(expected) || !luaTree.includes(expected)) {
    fail(`Lua table/tree 未显示 ${expected}`);
  }
}

if (luaNames.includes("OtherControl:oncmd")) {
  fail("Lua 返回了其他 class 方法");
}

for (const expected of ["QueryRunner.run", "QueryRunner.execute"]) {
  if (!tsNames.includes(expected)) {
    fail(`TS 缺少 ${expected}`);
  }
  if (!tsTable.includes(expected)) {
    fail(`TS table 未显示 ${expected}`);
  }
}

if (tsNames.includes("OtherRunner.run")) {
  fail("TS 返回了其他 class 方法");
}

if (luaJson.edges.length !== 0 || tsJson.edges.length !== 0) {
  fail("methods 查询不应生成关系边");
}
if (!luaJson.nodes.every((node) => node.kind === "method") || !tsJson.nodes.every((node) => node.kind === "method")) {
  fail("methods 查询只能返回 method 符号");
}
if (!luaTable.includes("src/slots.lua") || !tsTable.includes("src/query-runner.ts")) {
  fail("table 未显示文件信息");
}
' "$LUA_JSON" "$LUA_TABLE" "$LUA_TREE" "$TS_JSON" "$TS_TABLE"

echo "test-methods-query passed"
