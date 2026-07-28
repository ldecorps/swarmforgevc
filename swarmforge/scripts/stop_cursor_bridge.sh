#!/usr/bin/env bash
# Stops the Telegram ↔ Cursor SDK remote-control bridge. Idempotent — safe
# when nothing is running. Session state (agent id, topic map) is left on
# disk under .swarmforge/operator/ for restart.
#
# Usage: stop_cursor_bridge.sh [project-root]
#
# Env:
#   CURSOR_BRIDGE_STOP_DRYRUN=1    print actions, signal nothing
set -euo pipefail

ROOT="$(cd "${1:-.}" && pwd)"
OP_DIR="$ROOT/.swarmforge/operator"
PID_FILE="$OP_DIR/cursor-bridge.pid"
ENTRYPOINT_BASENAME="telegram-cursor-bridge.js"

signal_pid() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  kill -TERM "$pid" 2>/dev/null || true
  sleep 0.3
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
}

if [[ "${CURSOR_BRIDGE_STOP_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN stop_cursor_bridge pid_file=%s root=%s\n' "$PID_FILE" "$ROOT"
  exit 0
fi

stopped=0

if [[ -f "$PID_FILE" ]]; then
  pid="$(tr -d '[:space:]' < "$PID_FILE" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    signal_pid "$pid"
    stopped=1
  fi
  rm -f "$PID_FILE"
fi

while IFS= read -r line; do
  orphan_pid="${line%% *}"
  signal_pid "$orphan_pid"
  stopped=1
done < <(pgrep -fl "${ENTRYPOINT_BASENAME}.*${ROOT}" 2>/dev/null || true)

if [[ "$stopped" -eq 1 ]]; then
  echo "Stopped cursor bridge for $ROOT"
else
  echo "cursor bridge not running for $ROOT"
fi
