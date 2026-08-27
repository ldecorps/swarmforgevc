#!/usr/bin/env bash
# BL-1158: miniapp watchdog recovery — re-arm front desk when it owns the
# stack; otherwise bounce bridge-headless (legacy bridge-only path).
#
# Usage: recover_miniapp_bridge.sh <project-root> [port]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:?usage: recover_miniapp_bridge.sh <project-root> [port]}"
PORT="${2:-8765}"
OP_DIR="$ROOT/.swarmforge/operator"
FD_PID_FILE="$OP_DIR/front-desk-supervisor.pid"

if [[ -f "$FD_PID_FILE" ]]; then
  fd_pid="$(tr -d '[:space:]' < "$FD_PID_FILE" 2>/dev/null || true)"
  if [[ "$fd_pid" =~ ^[0-9]+$ ]] && kill -0 "$fd_pid" 2>/dev/null; then
    exec bash "$SCRIPT_DIR/rearm_front_desk_bridge.sh" "$ROOT" "$PORT"
  fi
fi

exec bash "$SCRIPT_DIR/bounce_bridge_headless.sh" "$ROOT" "$PORT"
