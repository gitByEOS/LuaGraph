#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-format-table.XXXXXX")"

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

echo "4. CLI table output"
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
IMPACT_TABLE="$(cd "$TEMP_PROJECT" && node "$PROJECT_DIR/dist/cli.js" impact leaf --depth 2 --format table)"

node -e '
const queryTable = process.argv[1];
const impactTable = process.argv[2];

const assertIncludes = (content, expected) => {
  if (!content.includes(expected)) {
    console.error(`缺少输出片段: ${JSON.stringify(expected)}`);
    console.error(content);
    process.exit(1);
  }
};

assertIncludes(queryTable, "expression\tcallers:leaf");
assertIncludes(queryTable, "count\t2");
assertIncludes(queryTable, "type\tkind\tpath/filePath\tline\tqualifiedName\tsignature");
assertIncludes(queryTable, "Symbol\tfunction\tsrc/api.lua\t3\tmiddle\tfunction middle()");
assertIncludes(queryTable, "Symbol\tfunction\tsrc/app.lua\t1\tappBoot\tfunction appBoot()");

assertIncludes(impactTable, "input\tleaf");
assertIncludes(impactTable, "count\t2");
assertIncludes(impactTable, "seeds\ntype\tkind\tfilePath\tline\tqualifiedName\tsignature");
assertIncludes(impactTable, "affected\ntype\tkind\tfilePath\tline\tqualifiedName\tsignature");
assertIncludes(impactTable, "files\npath");
assertIncludes(impactTable, "Symbol\tfunction\tsrc/api.lua\t3\tmiddle\tfunction middle()");
' "$QUERY_TABLE" "$IMPACT_TABLE"

echo "test-format-table passed"
