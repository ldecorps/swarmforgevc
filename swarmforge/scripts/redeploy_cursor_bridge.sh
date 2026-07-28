#!/usr/bin/env bash
# Compile extension and restart the supervised cursor bridge.
#
# Usage: redeploy_cursor_bridge.sh <project-root>
#
# Intended to run detached (e.g. from Telegram /redeploy) so the live bridge
# can stop itself without blocking the handler.
set -euo pipefail

ROOT="$(cd "${1:?usage: redeploy_cursor_bridge.sh <project-root>}" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OP_DIR="$ROOT/.swarmforge/operator"
LOG="$OP_DIR/redeploy-cursor-bridge.log"

mkdir -p "$OP_DIR"

{
  echo "=== redeploy $(date -Is) root=$ROOT ==="
  cd "$ROOT/extension"
  npm run compile
  "$SCRIPT_DIR/stop_cursor_bridge.sh" "$ROOT"
  sleep 1
  "$SCRIPT_DIR/start_cursor_bridge.sh" "$ROOT"
  echo "=== redeploy done $(date -Is) ==="
} >> "$LOG" 2>&1
