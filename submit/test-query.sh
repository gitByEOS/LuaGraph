#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-query.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

echo "1. Typecheck"
npm run typecheck

echo "2. Query tests"
npx vitest run test/query.test.ts test/indexer.test.ts test/cli.test.ts

echo "3. Build"
npm run build

echo "4. CLI init + index + query"
mkdir -p "$TEMP_PROJECT/src"
cat > "$TEMP_PROJECT/src/main.lua" <<'LUA'
function foo()
end
M = {}
function M.foo()
end
function obj:foo()
end
function init()
  foo()
  M.foo()
  obj:foo()
end
function boot()
  init()
end
LUA

node "$PROJECT_DIR/dist/cli.js" init "$TEMP_PROJECT" >/dev/null
node "$PROJECT_DIR/dist/cli.js" index "$TEMP_PROJECT" --force --format json >/dev/null
NAME_RESULT="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query name:init --format json)"
KIND_RESULT="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query kind:function --format json)"
CALLEES_RESULT="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query callees:init --format json)"
CALLERS_RESULT="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query callers:init --format json)"

node -e '
const nameResult = JSON.parse(process.argv[1]);
const kindResult = JSON.parse(process.argv[2]);
const calleesResult = JSON.parse(process.argv[3]);
const callersResult = JSON.parse(process.argv[4]);
const calleeNames = calleesResult.nodes.map((node) => node.qualifiedName).sort();
const callerNames = callersResult.nodes.map((node) => node.qualifiedName);

if (
  nameResult.count !== 1 ||
  nameResult.nodes[0]?.qualifiedName !== "init" ||
  kindResult.nodes.filter((node) => node.kind === "function").length !== 3 ||
  JSON.stringify(calleeNames) !== JSON.stringify(["M.foo", "foo", "obj:foo"].sort()) ||
  JSON.stringify(callerNames) !== JSON.stringify(["boot"])
) {
  console.error(`query 结果不符合预期: ${JSON.stringify({ nameResult, kindResult, calleesResult, callersResult })}`);
  process.exit(1);
}
' "$NAME_RESULT" "$KIND_RESULT" "$CALLEES_RESULT" "$CALLERS_RESULT"

echo "test-query passed"
