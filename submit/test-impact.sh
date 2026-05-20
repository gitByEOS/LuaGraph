#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-impact.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

echo "1. Typecheck"
npm run typecheck

echo "2. Impact and format tests"
npx vitest run test/format.test.ts test/impact.test.ts test/query.test.ts test/cli.test.ts

echo "3. Build"
npm run build

echo "4. CLI init + index + query + impact"
mkdir -p "$TEMP_PROJECT/src"
cat > "$TEMP_PROJECT/src/api.lua" <<'LUA'
function leaf()
end
function middle()
  leaf()
end
function cycleA()
  cycleB()
end
function cycleB()
  cycleA()
end
LUA

cat > "$TEMP_PROJECT/src/app.lua" <<'LUA'
function appBoot()
  middle()
end
LUA

cat > "$TEMP_PROJECT/src/root.lua" <<'LUA'
function root()
  appBoot()
end
LUA

node "$PROJECT_DIR/dist/cli.js" init "$TEMP_PROJECT" >/dev/null
node "$PROJECT_DIR/dist/cli.js" index "$TEMP_PROJECT" --force --format json >/dev/null

QUERY_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query callers:leaf --depth 2 --format json)"
QUERY_TABLE="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query callers:leaf --depth 2 --format table)"
QUERY_TREE="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" query callers:leaf --depth 2 --format tree)"
IMPACT_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" impact leaf --format json)"
IMPACT_FILE_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" impact src/api.lua --depth 2 --format json)"
IMPACT_DEPTH_JSON="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" impact leaf --depth 1 --format json)"
IMPACT_TREE="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" impact leaf --format tree)"

node -e '
const queryJson = JSON.parse(process.argv[1]);
const queryTable = process.argv[2];
const queryTree = process.argv[3];
const impactJson = JSON.parse(process.argv[4]);
const impactFileJson = JSON.parse(process.argv[5]);
const impactDepthJson = JSON.parse(process.argv[6]);
const impactTree = process.argv[7];

const names = (result) => result.nodes.map((node) => node.qualifiedName);
const fail = (reason) => {
  console.error(`impact 验收失败: ${reason}`);
  console.error(JSON.stringify({
    queryJson,
    queryTable,
    queryTree,
    impactJson,
    impactFileJson,
    impactDepthJson,
    impactTree,
  }));
  process.exit(1);
};
const assertIncludes = (content, expected) => {
  if (!content.includes(expected)) {
    fail(`缺少输出片段: ${JSON.stringify(expected)}`);
  }
};

assertIncludes(queryTable, "| Caller  | Kind     | File        | Line | Col |");
assertIncludes(queryTable, "| middle  | function | src/api.lua | 4    | 3   |");
assertIncludes(queryTable, "| appBoot | function | src/app.lua | 2    | 3   |");
assertIncludes(queryTable, "2 rows, target: leaf (src/api.lua:1)");

if (
  JSON.stringify(names(queryJson)) !== JSON.stringify(["middle", "appBoot"]) ||
  !queryTree.includes("leaf()  (src/api.lua:1)") ||
  !queryTree.includes("└── called by middle() [src/api.lua:4]") ||
  JSON.stringify(names(impactJson)) !== JSON.stringify(["middle", "appBoot"]) ||
  JSON.stringify(impactJson.files) !== JSON.stringify(["src/api.lua", "src/app.lua"]) ||
  JSON.stringify(names(impactFileJson)) !== JSON.stringify(["appBoot", "root"]) ||
  JSON.stringify(names(impactDepthJson)) !== JSON.stringify(["middle"]) ||
  !impactTree.includes("leaf()  (src/api.lua:1)") ||
  !impactTree.includes("└── called by middle() [src/api.lua:4]")
) {
  fail("JSON 或 tree 输出不符合预期");
}
' "$QUERY_JSON" "$QUERY_TABLE" "$QUERY_TREE" "$IMPACT_JSON" "$IMPACT_FILE_JSON" "$IMPACT_DEPTH_JSON" "$IMPACT_TREE"

echo "test-impact passed"
