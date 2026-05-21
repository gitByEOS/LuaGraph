#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-js-ts-art.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

echo "1. Build"
npm run build

echo "2. Prepare current project copy"
cp -R "$PROJECT_DIR/src" "$TEMP_PROJECT/src"
cp "$PROJECT_DIR/package.json" "$TEMP_PROJECT/package.json"
cp "$PROJECT_DIR/tsconfig.json" "$TEMP_PROJECT/tsconfig.json"

mkdir -p "$TEMP_PROJECT/src/__luagraph_js_ts_art_fixture" "$TEMP_PROJECT/src/__luagraph_lua_fixture"

cat > "$TEMP_PROJECT/src/__luagraph_js_ts_art_fixture/entry.ts" <<'TS'
import { fixtureJsHelper } from "./dep.js";
import { jsxWidget } from "./view.jsx";
import { tsxWidget } from "./component.js";

export function fixtureTsEntry() {
  return fixtureJsHelper() + jsxWidget() + tsxWidget();
}
TS

cat > "$TEMP_PROJECT/src/__luagraph_js_ts_art_fixture/dep.js" <<'JS'
export function fixtureJsHelper() {
  return 1;
}
JS

cat > "$TEMP_PROJECT/src/__luagraph_js_ts_art_fixture/bridge.js" <<'JS'
const dep = require("./dep.js");

export function fixtureJsBridge() {
  return dep.fixtureJsHelper();
}
JS

cat > "$TEMP_PROJECT/src/__luagraph_js_ts_art_fixture/view.jsx" <<'JSX'
export function jsxWidget() {
  return <div />;
}
JSX

cat > "$TEMP_PROJECT/src/__luagraph_js_ts_art_fixture/component.tsx" <<'TSX'
export const tsxWidget = () => <span />;
TSX

cat > "$TEMP_PROJECT/src/__luagraph_lua_fixture/api.lua" <<'LUA'
function luaLeaf()
end
LUA

cat > "$TEMP_PROJECT/src/__luagraph_lua_fixture/app.lua" <<'LUA'
require("src.__luagraph_lua_fixture.api")
function luaBoot()
  luaLeaf()
end
LUA

echo "3. Init + index current project copy"
node "$PROJECT_DIR/dist/cli.js" init "$TEMP_PROJECT" >/dev/null
INDEX_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" index . --force --format json)"

echo "4. Query JS/TS symbols and Requires"
FILES_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query kind:file --format json)"
FUNCTIONS_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query kind:function --format json)"
START_SERVER_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query name:startServer --format json)"
REQUIRES_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query requires:* --format json)"

node -e '
const indexJson = JSON.parse(process.argv[1]);
const filesJson = JSON.parse(process.argv[2]);
const functionsJson = JSON.parse(process.argv[3]);
const startServerJson = JSON.parse(process.argv[4]);
const requiresJson = JSON.parse(process.argv[5]);
const filePaths = new Set(filesJson.nodes.map((node) => node.path));
const functionNames = new Set(functionsJson.nodes.map((node) => node.qualifiedName));
const fail = (reason) => {
  console.error(`JS/TS query 验收失败: ${reason}`);
  console.error(JSON.stringify({ indexJson, filesJson, functionsJson, startServerJson, requiresJson }, null, 2));
  process.exit(1);
};
const requireEdge = (source, target, moduleName) => {
  if (!requiresJson.edges.some((edge) => edge.source === source && edge.target === target && edge.moduleName === moduleName && edge.isResolved === true)) {
    fail(`缺少 Requires: ${source} -> ${target} (${moduleName})`);
  }
};

for (const path of [
  "src/__luagraph_js_ts_art_fixture/entry.ts",
  "src/__luagraph_js_ts_art_fixture/component.tsx",
  "src/__luagraph_js_ts_art_fixture/dep.js",
  "src/__luagraph_js_ts_art_fixture/view.jsx",
  "src/core/indexer.ts",
  "src/web/assets/app.js",
]) {
  if (!filePaths.has(path)) {
    fail(`未索引文件 ${path}`);
  }
}

if (!functionNames.has("fixtureTsEntry") || !functionNames.has("startServer")) {
  fail("kind:function 未返回 JS/TS 函数");
}

if (startServerJson.nodes[0]?.filePath !== "src/web/server.ts") {
  fail("name:startServer 未查到当前项目已有函数");
}

requireEdge(
  "src/__luagraph_js_ts_art_fixture/entry.ts",
  "src/__luagraph_js_ts_art_fixture/dep.js",
  "./dep.js",
);
requireEdge(
  "src/__luagraph_js_ts_art_fixture/entry.ts",
  "src/__luagraph_js_ts_art_fixture/component.tsx",
  "./component.js",
);
requireEdge(
  "src/__luagraph_js_ts_art_fixture/bridge.js",
  "src/__luagraph_js_ts_art_fixture/dep.js",
  "./dep.js",
);
requireEdge("src/cli/cli.ts", "src/core/indexer.ts", "../core/indexer.js");
' "$INDEX_JSON" "$FILES_JSON" "$FUNCTIONS_JSON" "$START_SERVER_JSON" "$REQUIRES_JSON"

echo "5. Impact along JS/TS Requires"
JS_IMPACT_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" impact src/__luagraph_js_ts_art_fixture/dep.js --format json)"
CURRENT_IMPACT_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" impact src/core/indexer.ts --format json)"

node -e '
const jsImpact = JSON.parse(process.argv[1]);
const currentImpact = JSON.parse(process.argv[2]);
const fail = (reason) => {
  console.error(`JS/TS impact 验收失败: ${reason}`);
  console.error(JSON.stringify({ jsImpact, currentImpact }, null, 2));
  process.exit(1);
};

for (const path of [
  "src/__luagraph_js_ts_art_fixture/entry.ts",
  "src/__luagraph_js_ts_art_fixture/bridge.js",
]) {
  if (!jsImpact.files.includes(path)) {
    fail(`dep.js impact 未包含 ${path}`);
  }
}

if (!currentImpact.files.includes("src/cli/cli.ts")) {
  fail("当前项目 src/core/indexer.ts impact 未沿 Requires 找到 src/cli/cli.ts");
}
' "$JS_IMPACT_JSON" "$CURRENT_IMPACT_JSON"

echo "6. Lua query/impact regression"
LUA_QUERY_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query name:luaLeaf --format json)"
LUA_IMPACT_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" impact luaLeaf --format json)"
LUA_FILE_IMPACT_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" impact src/__luagraph_lua_fixture/api.lua --format json)"

node -e '
const query = JSON.parse(process.argv[1]);
const impact = JSON.parse(process.argv[2]);
const fileImpact = JSON.parse(process.argv[3]);
const fail = (reason) => {
  console.error(`Lua 回归验收失败: ${reason}`);
  console.error(JSON.stringify({ query, impact, fileImpact }, null, 2));
  process.exit(1);
};

if (query.nodes[0]?.qualifiedName !== "luaLeaf") {
  fail("query name:luaLeaf 未命中");
}

if (!impact.nodes.some((node) => node.qualifiedName === "luaBoot")) {
  fail("impact luaLeaf 未沿 Calls 找到 luaBoot");
}

if (!fileImpact.files.includes("src/__luagraph_lua_fixture/app.lua")) {
  fail("impact Lua 文件未沿 Requires 找到 app.lua");
}
' "$LUA_QUERY_JSON" "$LUA_IMPACT_JSON" "$LUA_FILE_IMPACT_JSON"

echo "test-js-ts-art passed"
