#!/usr/bin/env bash
# BL-710: compile extension and restart every Telegram-adjacent runtime.
#
# Usage: redeploy_all_telegram.sh <project-root> [miniapp-port]
#
# Order: compile once, then cursor bridge → front desk → mini app bridge.
set -euo pipefail

ROOT="$(cd "${1:?usage: redeploy_all_telegram.sh <project-root> [port]}" && pwd)"
PORT="${2:-8765}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OP_DIR="$ROOT/.swarmforge/operator"
LOG="$OP_DIR/redeploy-all-telegram.log"

mkdir -p "$OP_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/stop_ancillary_services.sh"

{
  echo "=== redeploy all telegram $(date -Is) root=$ROOT port=$PORT ==="
  stop_ancillary_init "$ROOT"
  cd "$ROOT/extension"
  npm run compile
  "$SCRIPT_DIR/stop_cursor_bridge.sh" "$ROOT"
  stop_front_desk
  "$SCRIPT_DIR/stop_bridge_headless.sh" "$ROOT"
  sleep 1
  "$SCRIPT_DIR/start_cursor_bridge.sh" "$ROOT"
  "$SCRIPT_DIR/launch_front_desk.sh" "$ROOT"
  "$SCRIPT_DIR/start_bridge_headless.sh" "$ROOT" "$PORT"
  echo "=== redeploy all telegram done $(date -Is) ==="
} >> "$LOG" 2>&1
