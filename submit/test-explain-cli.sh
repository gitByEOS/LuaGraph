#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-explain.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

echo "1. Build"
npm run build

echo "2. CLI init + index + explain"
mkdir -p "$TEMP_PROJECT/src"
cat > "$TEMP_PROJECT/src/main.lua" <<'LUA'
function helper()
end

function fallback()
end

function main(flag)
  if flag then
    helper()
  else
    fallback()
  end
end
LUA

node "$PROJECT_DIR/dist/cli.js" init "$TEMP_PROJECT" >/dev/null
node "$PROJECT_DIR/dist/cli.js" index "$TEMP_PROJECT" --force --format json >/dev/null

FILE_TEXT="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" explain src/main.lua --format text)"
FILE_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" explain src/main.lua --format json)"
SYMBOL_TEXT="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" explain main --depth 2 --format text)"
SYMBOL_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" explain main --depth 2 --format json)"

node -e '
const fileText = process.argv[1];
const fileJson = JSON.parse(process.argv[2]);
const symbolText = process.argv[3];
const symbolJson = JSON.parse(process.argv[4]);
const requiredTitles = ["target:", "entrypoints:", "flow:", "branches:", "dependencies:", "dataFlow:", "externalGaps:"];
const fail = (reason) => {
  console.error(`explain CLI 验收失败: ${reason}`);
  console.error(JSON.stringify({ fileText, fileJson, symbolText, symbolJson }, null, 2));
  process.exit(1);
};

for (const title of requiredTitles) {
  if (!fileText.includes(title) || !symbolText.includes(title)) {
    fail(`text 输出缺少标题 ${title}`);
  }
}

if (
  fileJson.target.type !== "file" ||
  fileJson.target.filePath !== "src/main.lua" ||
  !fileJson.entrypoints.some((entrypoint) => entrypoint.qualifiedName === "main") ||
  symbolJson.target.type !== "symbol" ||
  symbolJson.target.name !== "main" ||
  !symbolJson.entrypoints.some((entrypoint) => entrypoint.qualifiedName === "main") ||
  !JSON.stringify(symbolJson.flow).includes("helper") ||
  !JSON.stringify(symbolJson.flow).includes("fallback")
) {
  fail("json 输出字段不符合预期");
}
' "$FILE_TEXT" "$FILE_JSON" "$SYMBOL_TEXT" "$SYMBOL_JSON"

echo "test-explain-cli passed"
