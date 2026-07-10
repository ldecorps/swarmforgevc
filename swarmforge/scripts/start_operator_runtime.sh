#!/usr/bin/env bash
# Start the Operator v2 lightweight runtime (operator_runtime.bb).
#
# Mirrors start_handoff_daemon.sh: stop any prior runtime, launch the loop
# under nohup, wait for it to claim its pid file. The runtime is cheap and
# always-alive; it is what launches the disposable LLM Operator on events.
#
# Usage: start_operator_runtime.sh <project-root>
set -euo pipefail

ROOT="${1:?usage: start_operator_runtime.sh <project-root>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OP_DIR="$ROOT/.swarmforge/operator"
RUNTIME_BB="${OPERATOR_RUNTIME_BB:-$SCRIPT_DIR/operator_runtime.bb}"
LOG="$OP_DIR/runtime.log"
PID_WAIT_ATTEMPTS="${PID_WAIT_ATTEMPTS:-60}"

if [[ "${SWARMFORGE_SKIP_OPERATOR:-}" == "1" ]]; then
  echo "Skipping operator runtime (SWARMFORGE_SKIP_OPERATOR=1)."
  exit 0
fi

mkdir -p "$OP_DIR"

# Stop a prior runtime cleanly.
if [[ -f "$OP_DIR/runtime.pid" ]]; then
  pid="$(< "$OP_DIR/runtime.pid")"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -TERM "$pid" 2>/dev/null || true
  rm -f "$OP_DIR/runtime.pid"
fi
rm -f "$OP_DIR/stop"

nohup bb "$RUNTIME_BB" "$ROOT" >> "$LOG" 2>&1 &

claimed=0
for (( attempt = 1; attempt <= PID_WAIT_ATTEMPTS; attempt++ )); do
  if [[ -f "$OP_DIR/runtime.pid" ]]; then
    pid="$(< "$OP_DIR/runtime.pid")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      claimed=1; break
    fi
  fi
  sleep 0.1
done

if [[ "$claimed" -ne 1 ]]; then
  echo "operator runtime failed to claim runtime.pid under $OP_DIR" >&2
  exit 1
fi

echo "Started operator runtime (pid $(< "$OP_DIR/runtime.pid"))."
