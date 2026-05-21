#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "1. Typecheck"
npm run typecheck

echo "2. Parser tests"
npx vitest run test/parser.test.ts

echo "test-tree-sitter-lua passed"
