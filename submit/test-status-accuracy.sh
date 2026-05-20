#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-status-accuracy.XXXXXX")"

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

echo "4. CLI init + index + status"
mkdir -p "$TEMP_PROJECT/src"
cat > "$TEMP_PROJECT/src/player.lua" <<'LUA'
Player = class("Player")
function Player:move()
end
function spawnPlayer()
end
LUA

node "$PROJECT_DIR/dist/cli.js" init "$TEMP_PROJECT" >/dev/null
node "$PROJECT_DIR/dist/cli.js" index "$TEMP_PROJECT" --force --format json >/dev/null
STATUS_RESULT="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" status)"

node -e '
const result = JSON.parse(process.argv[1]);
const expectedKinds = { table: 1, method: 1, function: 1 };
const hasExpectedKinds = Object.entries(expectedKinds).every(
  ([kind, count]) => result.symbolKindCounts?.[kind] === count,
);

if (
  result.fileCount !== 1 ||
  result.symbolCount !== 3 ||
  result.edgeCount !== 3 ||
  result.parseErrorCount !== 0 ||
  result.pendingSyncChangeCount !== 0 ||
  !hasExpectedKinds
) {
  console.error(`status 结果不符合预期: ${JSON.stringify(result)}`);
  process.exit(1);
}
' "$STATUS_RESULT"

echo "test-status-accuracy passed"
