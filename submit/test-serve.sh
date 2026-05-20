#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PORT=47831
SERVER_PID=""
TMP_PROJECT="$(mktemp -d "${TMPDIR:-/tmp}/luagraph-serve.XXXXXX")"

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID"
    wait "$SERVER_PID" 2>/dev/null || true
  fi

  rm -rf "$TMP_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

npm run typecheck
npx vitest run test/server.test.ts test/web-assets.test.ts
npm run build

mkdir -p "$TMP_PROJECT/src"
cat > "$TMP_PROJECT/src/player.lua" <<'LUA'
Player = class("Player")
function Player:move()
end
LUA

node dist/cli.js init "$TMP_PROJECT" >/dev/null
node dist/cli.js index "$TMP_PROJECT" --force >/dev/null

node dist/cli.js serve "$TMP_PROJECT" --port "$PORT" > "$TMP_PROJECT/server.log" 2>&1 &
SERVER_PID="$!"

node --input-type=module - "http://127.0.0.1:$PORT" <<'NODE'
const [baseUrl] = process.argv.slice(2);

await waitForServer(`${baseUrl}/api/status`);

await assertJson(`${baseUrl}/api/status`, (body) => {
  assert(body.fileCount === 1, "status fileCount");
  assert(body.symbolCount === 2, "status symbolCount");
  assert(body.edgeCount === 2, "status edgeCount");
});

await assertJson(`${baseUrl}/api/graph`, (body) => {
  assert(Array.isArray(body.nodes), "graph nodes");
  assert(Array.isArray(body.edges), "graph edges");
  assert(body.nodes.some((node) => node.type === "File" && node.id === "src/player.lua"), "graph File");
  assert(body.nodes.some((node) => node.type === "Symbol" && node.filePath === "src/player.lua"), "graph Symbol");
  assert(body.edges.some((edge) => edge.kind === "Contains"), "graph Contains");
});

await assertJson(`${baseUrl}/api/code?path=src/player.lua&line=2&context=1`, (body) => {
  assert(body.startLine === 1, "code startLine");
  assert(body.endLine === 3, "code endLine");
  assert(body.code.includes("function Player:move()"), "code content");
});

await assertText(`${baseUrl}/`, "LuaGraph");
await assertText(`${baseUrl}/app.js`, "/api/graph");
await assertText(`${baseUrl}/style.css`, "body");

async function waitForServer(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry while the server starts.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("server did not start");
}

async function assertJson(url, validate) {
  const response = await fetch(url);
  assert(response.ok, `${url} HTTP ${response.status}`);
  validate(await response.json());
}

async function assertText(url, expectedText) {
  const response = await fetch(url);
  assert(response.ok, `${url} HTTP ${response.status}`);
  const text = await response.text();
  assert(text.includes(expectedText), `${url} missing ${expectedText}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
NODE

echo "serve acceptance passed"
