#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-requires.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

echo "1. Typecheck"
npm run typecheck

echo "2. Requires tests"
npx vitest run test/parser.test.ts test/indexer.test.ts test/syncer.test.ts test/query.test.ts test/impact.test.ts test/cli.test.ts

echo "3. Build"
npm run build

echo "4. CLI requires acceptance"
mkdir -p "$TEMP_PROJECT/src/base"
cat > "$TEMP_PROJECT/src/main.lua" <<'LUA'
local utils = require("utils")
local dynamic = require("base." .. name)
LUA

cat > "$TEMP_PROJECT/src/feature.lua" <<'LUA'
local utils = require("utils")
LUA

cat > "$TEMP_PROJECT/src/utils.lua" <<'LUA'
local M = {}
return M
LUA

node "$PROJECT_DIR/dist/cli.js" init "$TEMP_PROJECT" >/dev/null
node "$PROJECT_DIR/dist/cli.js" index "$TEMP_PROJECT" --force --format json >/dev/null

REQUIRES_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query requires:src/main.lua --format json)"
DEPENDENTS_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query dependents:src/utils.lua --format json)"
IMPACT_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" impact src/utils.lua --format json)"

node -e '
const requiresJson = JSON.parse(process.argv[1]);
const dependentsJson = JSON.parse(process.argv[2]);
const impactJson = JSON.parse(process.argv[3]);
const fail = (reason) => {
  console.error(`requires 验收失败: ${reason}`);
  console.error(JSON.stringify({ requiresJson, dependentsJson, impactJson }));
  process.exit(1);
};

if (requiresJson.edges.length !== 2) {
  fail("requires 边数量不正确");
}

const resolved = requiresJson.edges.find((edge) => edge.target === "src/utils.lua");
const dynamic = requiresJson.edges.find((edge) => edge.moduleName === "\"base.\" .. name");
if (resolved?.kind !== "Requires" || resolved.isResolved !== true) {
  fail("静态 require 未解析到 src/utils.lua");
}
if (dynamic?.kind !== "Requires" || dynamic.isResolved !== false) {
  fail("动态 require 未保留未解析边");
}
if (JSON.stringify(dependentsJson.nodes.map((node) => node.path)) !== JSON.stringify(["src/feature.lua", "src/main.lua"])) {
  fail("dependents 未返回依赖文件");
}
if (JSON.stringify(impactJson.files) !== JSON.stringify(["src/feature.lua", "src/main.lua"])) {
  fail("impact 未返回反向 Requires 影响文件");
}
' "$REQUIRES_JSON" "$DEPENDENTS_JSON" "$IMPACT_JSON"

echo "test-requires passed"
