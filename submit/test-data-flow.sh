#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TMP_PROJECT="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_PROJECT"
}
trap cleanup EXIT

assert_contains() {
  local output="$1"
  local needle="$2"
  local title="$3"

  if [[ "$output" != *"$needle"* ]]; then
    echo "断言失败: $title"
    echo "缺少: $needle"
    echo "$output"
    exit 1
  fi
}

cd "$PROJECT_DIR"
npm run build

mkdir -p "$TMP_PROJECT/src/core"

cat > "$TMP_PROJECT/SlotsControl.lua" <<'LUA'
SlotsControl = {}

function SlotsControl:ctor()
  self._spinData = nil
end

function SlotsControl:oncmd(cmd, data)
  if cmd == "spin" then
    data = data['list'][1]
    data = self:modifyRecvData(data)
    self._spinData = data
    self:dispatchEvent("spin", data)
  elseif cmd == "switch" then
    self:_checkSwitchFeature(data)
  end
end

function SlotsControl:requestSpinData()
  return self._spinData
end
LUA

cat > "$TMP_PROJECT/src/core/query.ts" <<'TS'
type Row = { id: string };

export async function queryProject(connection: unknown) {
  return executeQuery(connection, { key: "requires", value: "src/core/query.ts" }, 2);
}

export async function executeQuery(connection: unknown, relationTerm: { key: string; value: string }, depth: number) {
  return executeRequireQuery(connection, relationTerm, depth);
}

export async function executeRequireQuery(connection: unknown, relationTerm: { key: string; value: string }, depth: number) {
  const nodesById = new Map<string, Row>();
  const edgesByKey = new Map<string, Row>();
  const seedPaths = await queryRequireSeedPaths(connection, relationTerm.value);
  const visited = new Set(seedPaths);
  let frontier = seedPaths;

  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const nextFrontier: string[] = [];
    for (const originPath of frontier) {
      const rows = await queryRequireRows(connection, relationTerm.key, originPath);
      for (const row of rows) {
        const node = toFileNode(row);
        const edge = toRequireEdge(row);
        nodesById.set(node.id, node);
        edgesByKey.set(edge.id, edge);
        if (!visited.has(node.id)) {
          visited.add(node.id);
          nextFrontier.push(node.id);
        }
      }
    }
    frontier = nextFrontier;
  }

  return {
    nodes: sortNodes([...nodesById.values()]),
    edges: sortEdges([...edgesByKey.values()]),
  };
}

async function queryRequireSeedPaths(_connection: unknown, _path: string) {
  return ["src/core/query.ts"];
}

async function queryRequireRows(_connection: unknown, _key: string, _path: string) {
  return [];
}

function toFileNode(row: Row) {
  return row;
}

function toRequireEdge(row: Row) {
  return row;
}

function sortNodes(rows: Row[]) {
  return rows;
}

function sortEdges(rows: Row[]) {
  return rows;
}
TS

node "$PROJECT_DIR/dist/cli.js" init "$TMP_PROJECT" >/dev/null
node "$PROJECT_DIR/dist/cli.js" index "$TMP_PROJECT" --quiet

lua_method_output="$(node "$PROJECT_DIR/dist/cli.js" explain "SlotsControl:oncmd" --project-root "$TMP_PROJECT" --format text)"
assert_contains "$lua_method_output" "## Data Flow" "Lua method 包含 Data Flow"
assert_contains "$lua_method_output" "input cmd, data" "Lua method 展示 input"
assert_contains "$lua_method_output" "branch cmd == \"spin\"" "Lua method 展示 branch"
assert_contains "$lua_method_output" "assign data = data['list'][1]" "Lua method 展示 data 赋值"
assert_contains "$lua_method_output" "state/write self._spinData = data" "Lua method 展示 state/write"
assert_contains "$lua_method_output" "call self:dispatchEvent" "Lua method 展示调用副作用"
assert_contains "$lua_method_output" "call self:_checkSwitchFeature" "Lua method 展示分支内调用"
assert_contains "$lua_method_output" "return side effects" "Lua method 展示输出"

ts_method_output="$(node "$PROJECT_DIR/dist/cli.js" explain "executeRequireQuery" --project-root "$TMP_PROJECT" --format text)"
assert_contains "$ts_method_output" "input connection, relationTerm, depth" "TS method 展示 input"
assert_contains "$ts_method_output" "assign seedPaths" "TS method 展示 seedPaths"
assert_contains "$ts_method_output" "assign frontier" "TS method 展示 frontier"
assert_contains "$ts_method_output" "assign visited" "TS method 展示 visited"
assert_contains "$ts_method_output" "assign rows = await queryRequireRows" "TS method 展示 queryRequireRows"
assert_contains "$ts_method_output" "assign node = toFileNode(row)" "TS method 展示 node"
assert_contains "$ts_method_output" "assign edge = toRequireEdge(row)" "TS method 展示 edge"
assert_contains "$ts_method_output" "call nodesById.set" "TS method 展示 nodesById"
assert_contains "$ts_method_output" "call edgesByKey.set" "TS method 展示 edgesByKey"
assert_contains "$ts_method_output" "call nextFrontier.push" "TS method 展示 nextFrontier"
assert_contains "$ts_method_output" "return {" "TS method 展示 return"

lua_file_output="$(node "$PROJECT_DIR/dist/cli.js" explain "SlotsControl.lua" --project-root "$TMP_PROJECT" --format text)"
assert_contains "$lua_file_output" "## Top Method Flow" "Lua file 使用 Top Method Flow 标题"
assert_contains "$lua_file_output" "- SlotsControl:ctor" "Lua file 展示 ctor"
assert_contains "$lua_file_output" "- SlotsControl:oncmd" "Lua file 展示 oncmd"
assert_contains "$lua_file_output" "- SlotsControl:requestSpinData" "Lua file 展示 requestSpinData"

ts_file_output="$(node "$PROJECT_DIR/dist/cli.js" explain "src/core/query.ts" --project-root "$TMP_PROJECT" --format text)"
assert_contains "$ts_file_output" "- queryProject" "TS file 展示 queryProject"
assert_contains "$ts_file_output" "- executeQuery" "TS file 展示 executeQuery"
assert_contains "$ts_file_output" "- executeRequireQuery" "TS file 展示 executeRequireQuery"

echo "Data Flow Summary 验收通过"
