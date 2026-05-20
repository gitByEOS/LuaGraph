#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-constructor-impact.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

echo "1. Typecheck"
npm run typecheck

echo "2. Constructor impact tests"
npx vitest run test/impact.test.ts test/indexer.test.ts

echo "3. Build"
npm run build

echo "4. CLI init + index + impact"
mkdir -p "$TEMP_PROJECT/src/ui" "$TEMP_PROJECT/src/factory"
cat > "$TEMP_PROJECT/src/ui/player.lua" <<'LUA'
Player = class("Player")
LUA

cat > "$TEMP_PROJECT/src/factory/create_player.lua" <<'LUA'
function createPlayer()
  local player = Player.new()
  return player
end
LUA

node "$PROJECT_DIR/dist/cli.js" init "$TEMP_PROJECT" >/dev/null
node "$PROJECT_DIR/dist/cli.js" index "$TEMP_PROJECT" --force --format json >/dev/null
IMPACT_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" impact Player --format json)"

node -e '
const result = JSON.parse(process.argv[1]);
const names = result.nodes.map((node) => node.qualifiedName);

if (JSON.stringify(result.seeds.map((seed) => seed.qualifiedName)) !== JSON.stringify(["Player"])) {
  console.error(`构造影响验收失败: seeds 不符合预期 ${JSON.stringify(result.seeds)}`);
  process.exit(1);
}

if (JSON.stringify(names) !== JSON.stringify(["createPlayer"]) || result.edges.length !== 1) {
  console.error(`构造影响验收失败: ${JSON.stringify(result)}`);
  process.exit(1);
}
' "$IMPACT_JSON"

echo "test-constructor-impact passed"
