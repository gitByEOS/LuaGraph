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
const requiredTitles = [
  "## Overview",
  "## Entry Points",
  "## Internal Logic",
  "## Data Flow",
  "## External Contracts",
  "## Unresolved Runtime",
];
const fail = (reason) => {
  console.error(`explain CLI 验收失败: ${reason}`);
  console.error(JSON.stringify({ fileText, fileJson, symbolText, symbolJson }, null, 2));
  process.exit(1);
};

if (!fileText.includes("# Explain: src/main.lua") || !symbolText.includes("# Explain: main")) {
  fail("text 输出缺少 Explain 标题");
}

for (const title of requiredTitles) {
  if (!fileText.includes(title) || !symbolText.includes(title)) {
    fail(`text 输出缺少标题 ${title}`);
  }
}

if (
  fileText.includes("target:") ||
  fileText.includes("entrypoints:") ||
  fileText.includes("externalGaps:") ||
  fileText.includes("safeConclusion") ||
  fileText.includes("nextQueries") ||
  fileText.includes("## Main Logic") ||
  fileText.includes("commands:") ||
  fileText.includes("luagraph explain main --depth") ||
  fileText.includes("luagraph query callees:main") ||
  symbolText.includes("## Main Logic") ||
  symbolText.includes("commands:") ||
  symbolText.includes("luagraph explain main --depth") ||
  symbolText.includes("luagraph query callees:main")
) {
  fail("text 输出仍包含旧格式或噪音字段");
}

for (const content of ["- file: src/main.lua", "- reason: exported", "- reason: selected-symbol", "- calls: helper, fallback"]) {
  if (!fileText.includes(content) && !symbolText.includes(content)) {
    fail(`text 输出缺少关键内容 ${content}`);
  }
}

if (!fileText.includes("None") || !symbolText.includes("None")) {
  fail("text 空态没有输出 None");
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
