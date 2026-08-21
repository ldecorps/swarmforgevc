#!/usr/bin/env bash
# BL-993: launches the always-on watch for operator_runtime.bb
# (operator_runtime_supervisor.bb). A SEPARATE lifecycle from
# start_operator_runtime.sh on purpose (invariant 3: the watcher must not
# require operator_runtime.bb to be alive to run) - this script starts once
# at swarm boot from start_ancillary_services.sh; the supervisor's own
# restarts of operator_runtime.bb go through start_operator_runtime.sh
# directly and never touch this launcher again, so calling it repeatedly
# from a restart loop is not a risk this script needs to guard against
# beyond the ordinary idempotent already-running check below.
#
# Mirrors launch_front_desk.sh's own idempotent-already-running guard.
#
# Usage: launch_operator_runtime_supervisor.sh <project-root>
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
launch_operator_runtime_supervisor.sh — lifecycle start entry point.

Stop: stop_ancillary_services.sh / ./stop-swarm.sh (or ./swarm-kill for pipeline-only)

Usage: see header comments above.
EOF
  exit 0
fi


ROOT="${1:?usage: launch_operator_runtime_supervisor.sh <project-root>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OP_DIR="$ROOT/.swarmforge/operator"
SUPERVISOR_BB="$SCRIPT_DIR/operator_runtime_supervisor.bb"
PID_FILE="$OP_DIR/operator-runtime-supervisor.pid"
LOG="$OP_DIR/operator-runtime-supervisor.log"
PID_WAIT_ATTEMPTS="${PID_WAIT_ATTEMPTS:-60}"

mkdir -p "$OP_DIR"

# ── idempotent: already running -> do nothing (mirrors launch_front_desk.sh's
#    own already-running guard). ────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(< "$PID_FILE")"
  if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "launch_operator_runtime_supervisor: already running (pid $existing_pid); not double-launching" >&2
    exit 0
  fi
fi

rm -f "$OP_DIR/operator-runtime-supervisor.stop"

nohup bb "$SUPERVISOR_BB" "$ROOT" >> "$LOG" 2>&1 &
launcher_pid=$!

claimed=0
for (( attempt = 1; attempt <= PID_WAIT_ATTEMPTS; attempt++ )); do
  if [[ -f "$PID_FILE" ]]; then
    pid="$(< "$PID_FILE")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      claimed=1; break
    fi
  fi
  if ! kill -0 "$launcher_pid" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

if [[ "$claimed" -ne 1 ]]; then
  echo "launch_operator_runtime_supervisor: failed to claim its own pid file under $OP_DIR" >&2
  if [[ -f "$LOG" ]]; then
    echo "launch_operator_runtime_supervisor: last lines of $LOG:" >&2
    tail -n 5 "$LOG" >&2
  fi
  exit 1
fi

echo "Started operator-runtime watch (pid $(< "$PID_FILE"))."
