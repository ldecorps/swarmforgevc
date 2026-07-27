#!/usr/bin/env bash
# Stops the supervised cursor bridge. Idempotent — safe when nothing is running.
#
# Usage: stop_cursor_bridge.sh [project-root]
#
# Env:
#   CURSOR_BRIDGE_STOP_DRYRUN=1    print actions, signal nothing
set -euo pipefail

ROOT="$(cd "${1:-.}" && pwd)"
OP_DIR="$ROOT/.swarmforge/operator"
SUPERVISOR_PID_FILE="$OP_DIR/cursor-bridge-supervisor.pid"
STOP_FILE="$OP_DIR/cursor-bridge-supervisor.stop"
ENTRYPOINT_BASENAME="telegram-cursor-bridge.js"

signal_pid() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  kill -TERM "$pid" 2>/dev/null || true
  sleep 0.3
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
}

if [[ "${CURSOR_BRIDGE_STOP_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN stop_cursor_bridge supervisor_pid=%s root=%s\n' "$SUPERVISOR_PID_FILE" "$ROOT"
  exit 0
fi

stopped=0

mkdir -p "$OP_DIR"
touch "$STOP_FILE"
sleep 1

if [[ -f "$SUPERVISOR_PID_FILE" ]]; then
  pid="$(tr -d '[:space:]' < "$SUPERVISOR_PID_FILE" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    signal_pid "$pid"
    stopped=1
  fi
  rm -f "$SUPERVISOR_PID_FILE"
fi

while IFS= read -r line; do
  orphan_pid="${line%% *}"
  signal_pid "$orphan_pid"
  stopped=1
done < <(pgrep -fl "${ENTRYPOINT_BASENAME}.*${ROOT}" 2>/dev/null || true)

rm -f "$STOP_FILE" "$OP_DIR/cursor-bridge.pid"

if [[ "$stopped" -eq 1 ]]; then
  echo "Stopped cursor bridge for $ROOT"
else
  echo "cursor bridge not running for $ROOT"
fi
