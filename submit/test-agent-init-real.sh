#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_PROJECT="$(mktemp -d)"

cleanup() {
  rm -rf "$TEMP_PROJECT"
}

trap cleanup EXIT

cd "$PROJECT_DIR"

vp install
vp test
vp check
vp run build
node dist/cli.js init "$TEMP_PROJECT"

test -f "$TEMP_PROJECT/.luagraph/config.json"
test -d "$TEMP_PROJECT/.luagraph/kuzu"
