#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-art-output.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

echo "1. Typecheck"
npm run typecheck

echo "2. Format tests"
npx vitest run test/format.test.ts

echo "3. Build"
npm run build

echo "4. CLI art output"
mkdir -p "$TEMP_PROJECT/src"
cat > "$TEMP_PROJECT/src/api.lua" <<'LUA'
function leaf()
end
function middle()
  leaf()
end
LUA

cat > "$TEMP_PROJECT/src/app.lua" <<'LUA'
function appBoot()
  middle()
end
LUA

node "$PROJECT_DIR/dist/cli.js" init "$TEMP_PROJECT" >/dev/null
node "$PROJECT_DIR/dist/cli.js" index "$TEMP_PROJECT" --force --format json >/dev/null

QUERY_TABLE="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query callers:leaf --depth 2 --format table)"
QUERY_TREE="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query callers:leaf --depth 2 --format tree)"
IMPACT_TABLE="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" impact leaf --depth 2 --format table)"
IMPACT_TREE="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" impact leaf --depth 2 --format tree)"

node -e '
const [queryTable, queryTree, impactTable, impactTree] = process.argv.slice(1);

const fail = (reason) => {
  console.error(`美术输出验收失败: ${reason}`);
  console.error(JSON.stringify({ queryTable, queryTree, impactTable, impactTree }, null, 2));
  process.exit(1);
};
const assertIncludes = (content, expected) => {
  if (!content.includes(expected)) {
    fail(`缺少输出片段: ${JSON.stringify(expected)}`);
  }
};

assertIncludes(queryTable, "+---------+----------+-------------+------+-----+");
assertIncludes(queryTable, "| Caller  | Kind     | File        | Line | Col |");
assertIncludes(queryTable, "| middle  | function | src/api.lua | 4    | 3   |");
assertIncludes(queryTable, "2 rows, target: leaf (src/api.lua:1)");
assertIncludes(queryTree, "leaf()  (src/api.lua:1)");
assertIncludes(queryTree, "└── called by middle() [src/api.lua:4]");
assertIncludes(queryTree, "    └── called by appBoot() [src/app.lua:2]");

assertIncludes(impactTable, "input: leaf");
assertIncludes(impactTable, "affected\n+---------+----------+-------------+------+--------------------+");
assertIncludes(impactTable, "| appBoot | function | src/app.lua | 1    | function appBoot() |");
assertIncludes(impactTree, "leaf()  (src/api.lua:1)");
assertIncludes(impactTree, "└── called by middle() [src/api.lua:4]");
' "$QUERY_TABLE" "$QUERY_TREE" "$IMPACT_TABLE" "$IMPACT_TREE"

echo "test-art-output passed"
