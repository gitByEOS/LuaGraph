#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-index.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

echo "1. Typecheck"
npm run typecheck

echo "2. Test"
npx vitest run

echo "3. Build"
npm run build

echo "4. CLI init + index"
mkdir -p "$TEMP_PROJECT/src"
cat > "$TEMP_PROJECT/src/player.lua" <<'LUA'
Player = class("Player")
function Player:move()
end
LUA

node "$PROJECT_DIR/dist/cli.js" init "$TEMP_PROJECT" >/dev/null
INDEX_RESULT="$(node "$PROJECT_DIR/dist/cli.js" index "$TEMP_PROJECT" --force --format json)"

node -e '
const result = JSON.parse(process.argv[1]);
if (result.fileCount !== 1 || result.symbolCount !== 2 || result.containsCount !== 2) {
  console.error(`索引结果不符合预期: ${JSON.stringify(result)}`);
  process.exit(1);
}
' "$INDEX_RESULT"

echo "test-index passed"
