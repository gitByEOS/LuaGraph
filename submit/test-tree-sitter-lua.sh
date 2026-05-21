#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "1. Typecheck"
npm run typecheck

echo "2. Parser tests"
npx vitest run test/parser.test.ts

echo "3. Runtime import and parse"
node --input-type=module <<'NODE'
import Parser from "tree-sitter";
import Lua from "tree-sitter-lua";

const parser = new Parser();
parser.setLanguage(Lua);

const tree = parser.parse('local M = require("feature.foo")\nfunction M:bar()\nend');
const call = tree.rootNode.descendantsOfType("function_call")[0];

if (tree.rootNode.type !== "chunk" || call?.text !== 'require("feature.foo")') {
  throw new Error("tree-sitter-lua import/parse check failed");
}
NODE

echo "test-tree-sitter-lua passed"
