#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-explain.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

echo "1. Build"
npm run build

echo "2. Create single-file project"
mkdir -p "$TEMP_PROJECT/src"
cat > "$TEMP_PROJECT/src/main.lua" <<'LUA'
local missing = require("missing")

function helper()
  return 1
end

function boot(flag)
  if flag then
    return helper()
  end
  return missing
end
LUA

echo "3. Explain core assertions"
node --input-type=module - "$PROJECT_DIR" "$TEMP_PROJECT" <<'NODE'
const [projectDir, tempProject] = process.argv.slice(2);
const { initializeProject, indexProject, explainProject } = await import(`${projectDir}/dist/lib.js`);

await initializeProject(tempProject);
await indexProject(tempProject, { force: true });

const result = await explainProject(tempProject, "main.lua", { depth: 2 });
const entryNames = result.entrypoints.map((entrypoint) => entrypoint.qualifiedName);
const branchConditions = result.branches.map((branch) => branch.condition);
const dependencyNames = result.dependencies.map((dependency) => dependency.moduleName);

if (
  result.target.filePath !== "src/main.lua" ||
  !entryNames.includes("boot") ||
  !branchConditions.includes("flag") ||
  !dependencyNames.includes("missing") ||
  !result.dependencies.some((dependency) => dependency.moduleName === "missing" && dependency.isResolved === false) ||
  !result.externalGaps.includes("未解析 require/import: missing") ||
  result.dataFlow.map((step) => step.source).join(">") !== "input>entrypoint>callee>return"
) {
  console.error(`explain 结果不符合预期: ${JSON.stringify(result, null, 2)}`);
  process.exit(1);
}
NODE

echo "test-explain-core passed"
