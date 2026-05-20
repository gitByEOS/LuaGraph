#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMP_PROJECT="$(mktemp -d)"

cleanup() {
  rm -rf "$TEMP_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

npm run typecheck
npx vitest run test/syncer.test.ts test/status.test.ts test/cli.test.ts test/indexer.test.ts
npm run build

mkdir -p "$TEMP_PROJECT/src"
printf 'function before()\nend\n' > "$TEMP_PROJECT/src/changed.lua"
printf 'function removed()\nend\n' > "$TEMP_PROJECT/src/removed.lua"

node dist/cli.js init "$TEMP_PROJECT" > /dev/null
node dist/cli.js index "$TEMP_PROJECT" --quiet

printf 'function after()\nend\nfunction afterAgain()\nend\n' > "$TEMP_PROJECT/src/changed.lua"
printf 'function added()\nend\n' > "$TEMP_PROJECT/src/added.lua"
rm "$TEMP_PROJECT/src/removed.lua"

SYNC_OUTPUT="$(node dist/cli.js sync "$TEMP_PROJECT" --format json)"
node -e '
const result = JSON.parse(process.argv[1]);
if (
  result.scannedFileCount !== 2 ||
  result.changedFileCount !== 2 ||
  result.removedFileCount !== 1 ||
  result.symbolCount !== 3 ||
  result.containsCount !== 3
) {
  throw new Error(`sync 验收失败: ${JSON.stringify(result)}`);
}
' "$SYNC_OUTPUT"

STATUS_OUTPUT="$(node dist/cli.js status "$TEMP_PROJECT")"
node -e '
const status = JSON.parse(process.argv[1]);
if (status.pendingSyncChangeCount !== 0 || status.fileCount !== 2 || status.symbolCount !== 3) {
  throw new Error(`status 验收失败: ${JSON.stringify(status)}`);
}
' "$STATUS_OUTPUT"
