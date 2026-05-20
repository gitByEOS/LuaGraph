#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-sample.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

echo "1. Typecheck"
npm run typecheck

echo "2. Test"
npx vitest run test/sample.test.ts test/cli.test.ts

echo "3. Build"
npm run build

echo "4. CLI init + index + sample"
mkdir -p "$TEMP_PROJECT/src"
cat > "$TEMP_PROJECT/src/player.lua" <<'LUA'
Player = class("Player")
function Player:move()
end
function spawnPlayer()
end
local function buildLocal()
end
LUA

node "$PROJECT_DIR/dist/cli.js" init "$TEMP_PROJECT" >/dev/null
node "$PROJECT_DIR/dist/cli.js" index "$TEMP_PROJECT" --force --format json >/dev/null
SAMPLE_RESULT="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" sample --limit 4 --format json)"

node -e '
const result = JSON.parse(process.argv[1]);
const fields = ["kind", "name", "qualifiedName", "filePath", "startLine", "isLocal", "signature"];
const symbols = result.symbols ?? [];
const hasOnlyExpectedFields = symbols.every((symbol) => {
  const keys = Object.keys(symbol).sort();
  return JSON.stringify(keys) === JSON.stringify([...fields].sort());
});
const hasExpectedLocal = symbols.some((symbol) => symbol.name === "buildLocal" && symbol.isLocal === true);

if (
  result.count !== 4 ||
  symbols.length !== 4 ||
  symbols[0]?.kind !== "table" ||
  symbols[1]?.kind !== "method" ||
  symbols[2]?.kind !== "function" ||
  !hasExpectedLocal ||
  !hasOnlyExpectedFields
) {
  console.error(`sample 结果不符合预期: ${JSON.stringify(result)}`);
  process.exit(1);
}
' "$SAMPLE_RESULT"

echo "test-sample passed"
