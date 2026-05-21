#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_LUA_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-core-lua.XXXXXX")"
TEMP_SCAN_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-core-scan.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_LUA_PROJECT" "$TEMP_SCAN_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

echo "1. Build"
npm run build

echo "2. Lua index regression"
mkdir -p "$TEMP_LUA_PROJECT/src"
cat > "$TEMP_LUA_PROJECT/src/player.lua" <<'LUA'
Player = class("Player")
function Player:move()
end
LUA

node "$PROJECT_DIR/dist/cli.js" init "$TEMP_LUA_PROJECT" >/dev/null
INDEX_JSON="$(node "$PROJECT_DIR/dist/cli.js" index "$TEMP_LUA_PROJECT" --force --format json)"

node -e '
const result = JSON.parse(process.argv[1]);
if (result.fileCount !== 1 || result.symbolCount !== 2 || result.containsCount !== 2) {
  console.error(`Lua 索引回归: ${JSON.stringify(result)}`);
  process.exit(1);
}
' "$INDEX_JSON"

echo "3. Scanner config multilang rules"
mkdir -p "$TEMP_SCAN_PROJECT/src" \
  "$TEMP_SCAN_PROJECT/node_modules/pkg" \
  "$TEMP_SCAN_PROJECT/dist" \
  "$TEMP_SCAN_PROJECT/build" \
  "$TEMP_SCAN_PROJECT/coverage" \
  "$TEMP_SCAN_PROJECT/.next" \
  "$TEMP_SCAN_PROJECT/.vite"

cat > "$TEMP_SCAN_PROJECT/src/main.lua" <<'LUA'
return 1
LUA
cat > "$TEMP_SCAN_PROJECT/src/app.ts" <<'TS'
export const app = 1;
TS
cat > "$TEMP_SCAN_PROJECT/src/view.jsx" <<'JSX'
export default null;
JSX
cat > "$TEMP_SCAN_PROJECT/src/types.d.ts" <<'TS'
declare const app: number;
TS
cat > "$TEMP_SCAN_PROJECT/node_modules/pkg/index.js" <<'JS'
export const dep = 1;
JS
cat > "$TEMP_SCAN_PROJECT/dist/bundle.js" <<'JS'
export const bundle = 1;
JS
cat > "$TEMP_SCAN_PROJECT/build/output.ts" <<'TS'
export const output = 1;
TS
cat > "$TEMP_SCAN_PROJECT/coverage/report.js" <<'JS'
export const report = 1;
JS
cat > "$TEMP_SCAN_PROJECT/.next/page.tsx" <<'TSX'
export const page = null;
TSX
cat > "$TEMP_SCAN_PROJECT/.vite/cache.js" <<'JS'
export const cache = 1;
JS

node --input-type=module - "$PROJECT_DIR" "$TEMP_SCAN_PROJECT" <<'JS'
import { pathToFileURL } from "node:url";
import nodePath from "node:path";

const projectDir = process.argv[2];
const scanRoot = process.argv[3];
const lib = await import(pathToFileURL(nodePath.join(projectDir, "dist/lib.js")).href);

const { defaultConfig, scanProjectFiles } = lib;
const requiredIncludes = ["**/*.lua", "**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx"];
const requiredExcludes = ["**/*.d.ts", "node_modules/", "dist/", "build/", "coverage/", ".next/", ".vite/"];

for (const pattern of requiredIncludes) {
  if (!defaultConfig.include.includes(pattern)) {
    throw new Error(`默认 include 缺少 ${pattern}`);
  }
}

for (const pattern of requiredExcludes) {
  if (!defaultConfig.exclude.includes(pattern)) {
    throw new Error(`默认 exclude 缺少 ${pattern}`);
  }
}

const files = await scanProjectFiles(scanRoot, defaultConfig);
const paths = files.map((file) => file.path);
const expected = ["src/app.ts", "src/main.lua", "src/view.jsx"];

if (JSON.stringify(paths) !== JSON.stringify(expected)) {
  throw new Error(`扫描结果不符合预期: ${JSON.stringify(paths)}`);
}
JS

echo "test-core-multilang passed"
