#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "1. Typecheck"
npm run typecheck

echo "2. Layout-focused tests"
npx vitest run test/parser.test.ts test/indexer.test.ts test/syncer.test.ts test/query.test.ts test/server.test.ts test/web-assets.test.ts

echo "3. Build"
npm run build

echo "test-layout passed"
