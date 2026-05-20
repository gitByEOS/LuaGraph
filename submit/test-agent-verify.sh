#!/bin/bash
set -e

PROJECT_ROOT="/Users/bole/dev/mul-agents/LuaGraph"

echo "=== Systems/ 分析结果验证 ==="

echo ""
echo "1. 初始化项目..."
npx luagraph init "$PROJECT_ROOT"

echo ""
echo "2. 分析 Systems/ ..."
npx luagraph analyze "$PROJECT_ROOT" --include "Systems/**/*.lua"

echo ""
echo "3. 验证状态..."
STATUS=$(npx luagraph status "$PROJECT_ROOT")
echo "$STATUS"

FILE_COUNT=$(echo "$STATUS" | grep -o 'fileCount: [0-9]*' | grep -o '[0-9]*')
SYMBOL_COUNT=$(echo "$STATUS" | grep -o 'symbolCount: [0-9]*' | grep -o '[0-9]*')
EDGE_COUNT=$(echo "$STATUS" | grep -o 'edgeCount: [0-9]*' | grep -o '[0-9]*')

echo ""
echo "=== 验证结果 ==="
PASS=true

if [ "$FILE_COUNT" = "18" ]; then
  echo "PASS: fileCount = $FILE_COUNT (期望 18)"
else
  echo "FAIL: fileCount = $FILE_COUNT (期望 18)"
  PASS=false
fi

if [ "$SYMBOL_COUNT" -gt 0 ] 2>/dev/null; then
  echo "PASS: symbolCount = $SYMBOL_COUNT > 0"
else
  echo "FAIL: symbolCount = $SYMBOL_COUNT (期望 > 0)"
  PASS=false
fi

if [ "$EDGE_COUNT" -gt 0 ] 2>/dev/null; then
  echo "PASS: edgeCount = $EDGE_COUNT > 0"
else
  echo "FAIL: edgeCount = $EDGE_COUNT (期望 > 0)"
  PASS=false
fi

echo ""
if [ "$PASS" = true ]; then
  echo "全部验证通过!"
  exit 0
else
  echo "部分验证失败!"
  exit 1
fi
