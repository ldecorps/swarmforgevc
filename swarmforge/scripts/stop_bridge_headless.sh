#!/usr/bin/env bash
# Stops the supervised Mini App headless bridge. Idempotent.
#
# Usage: stop_bridge_headless.sh [project-root]
#
# Env:
#   BRIDGE_HEADLESS_STOP_DRYRUN=1    print actions, signal nothing
set -euo pipefail

ROOT="$(cd "${1:-.}" && pwd)"
OP_DIR="$ROOT/.swarmforge/operator"
SUPERVISOR_PID_FILE="$OP_DIR/bridge-headless-supervisor.pid"
STOP_FILE="$OP_DIR/bridge-headless-supervisor.stop"
ENTRYPOINT_BASENAME="start-bridge-headless.js"

signal_pid() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  kill -TERM "$pid" 2>/dev/null || true
  sleep 0.3
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
}

if [[ "${BRIDGE_HEADLESS_STOP_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN stop_bridge_headless supervisor_pid=%s root=%s\n' "$SUPERVISOR_PID_FILE" "$ROOT"
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

rm -f "$STOP_FILE" "$OP_DIR/bridge-headless.pid"

if [[ "$stopped" -eq 1 ]]; then
  echo "Stopped bridge-headless for $ROOT"
else
  echo "bridge-headless not running for $ROOT"
fi
