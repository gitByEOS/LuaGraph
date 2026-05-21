#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-extends.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

echo "1. Typecheck"
npm run typecheck

echo "2. Extends tests"
npx vitest run test/parser.test.ts test/indexer.test.ts test/syncer.test.ts test/query.test.ts test/format.test.ts

echo "3. Build"
npm run build

echo "4. CLI init + index + query extends"
mkdir -p "$TEMP_PROJECT/src"
cat > "$TEMP_PROJECT/src/inherit.lua" <<'LUA'
Base = {}
Child = setmetatable({}, { __index = Base })
GrandChild = setmetatable({}, { __index = Child })
Self.__index = Self
Dynamic = setmetatable({}, { __index = getParent() })
LUA

node "$PROJECT_DIR/dist/cli.js" init "$TEMP_PROJECT" >/dev/null
node "$PROJECT_DIR/dist/cli.js" index "$TEMP_PROJECT" --force --format json >/dev/null
EXTENDS_RESULT="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query extends:Child --format json)"
SUBCLASSES_RESULT="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query subclasses:Child --format json)"
TABLE_RESULT="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query extends:Child --format table)"
TREE_RESULT="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query subclasses:Base --depth 2 --format tree)"

node -e '
const extendsResult = JSON.parse(process.argv[1]);
const subclassesResult = JSON.parse(process.argv[2]);
const tableResult = process.argv[3];
const treeResult = process.argv[4];

if (
  JSON.stringify(extendsResult.nodes.map((node) => node.qualifiedName)) !== JSON.stringify(["Base"]) ||
  extendsResult.edges[0]?.kind !== "Extends" ||
  JSON.stringify(subclassesResult.nodes.map((node) => node.qualifiedName)) !== JSON.stringify(["GrandChild"]) ||
  !tableResult.includes("Parent") ||
  !treeResult.includes("subclass Child")
) {
  console.error(`extends 查询不符合预期: ${JSON.stringify({ extendsResult, subclassesResult, tableResult, treeResult })}`);
  process.exit(1);
}
' "$EXTENDS_RESULT" "$SUBCLASSES_RESULT" "$TABLE_RESULT" "$TREE_RESULT"

echo "5. CLI sync refreshes Extends"
cat > "$TEMP_PROJECT/src/inherit.lua" <<'LUA'
Base = {}
OtherBase = {}
Child = setmetatable({}, { __index = OtherBase })
LUA

node "$PROJECT_DIR/dist/cli.js" sync "$TEMP_PROJECT" --format json >/dev/null
SYNC_EXTENDS_RESULT="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query extends:Child --format json)"
SYNC_OLD_SUBCLASSES_RESULT="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query subclasses:Base --format json)"

node -e '
const extendsResult = JSON.parse(process.argv[1]);
const oldSubclassesResult = JSON.parse(process.argv[2]);

if (
  JSON.stringify(extendsResult.nodes.map((node) => node.qualifiedName)) !== JSON.stringify(["OtherBase"]) ||
  oldSubclassesResult.count !== 0 ||
  oldSubclassesResult.edges.length !== 0
) {
  console.error(`sync 后 Extends 不符合预期: ${JSON.stringify({ extendsResult, oldSubclassesResult })}`);
  process.exit(1);
}
' "$SYNC_EXTENDS_RESULT" "$SYNC_OLD_SUBCLASSES_RESULT"

echo "test-extends passed"
