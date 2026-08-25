#!/usr/bin/env bash
# BL-993 scenario 05 acceptance check ("the watch keeps running after the
# runtime it watches has died" / invariant 3): a process-architecture
# property, not a pure decision - real supervisor process, real fixture
# "operator" process, real kill. Kept fast (short interval, no real
# start_operator_runtime.sh in the loop) and bounded (this script's own
# timeout, plus the caller's spawnSync timeout).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPERVISOR_BB="$SCRIPT_DIR/../operator_runtime_supervisor.bb"

ROOT="$(mktemp -d)"
cleanup() {
  [[ -n "${SUP_PID:-}" ]] && kill -0 "$SUP_PID" 2>/dev/null && kill -TERM "$SUP_PID" 2>/dev/null
  [[ -n "${FAKE_OP_PID:-}" ]] && kill -0 "$FAKE_OP_PID" 2>/dev/null && kill -TERM "$FAKE_OP_PID" 2>/dev/null
  rm -rf "$ROOT"
}
trap cleanup EXIT

OP_DIR="$ROOT/.swarmforge/operator"
mkdir -p "$OP_DIR"

# A fake "operator_runtime.bb" - a real bb process, the marker as a literal
# arg (java.lang.ProcessHandle's own commandLine reads the REAL argv, not a
# shell-spoofed argv[0] - `exec -a` does not fool it; confirmed empirically
# against this project's own process_table_lib.bb during this ticket).
bb -e '(Thread/sleep 60000)' operator_runtime.bb &
FAKE_OP_PID=$!
echo "$FAKE_OP_PID" > "$OP_DIR/runtime.pid"

# Never actually reached (the fixture starts "healthy" and dies mid-test) -
# still points somewhere harmless if a check ever needs to restart.
export OPERATOR_WATCH_START_CMD="/bin/true"
export OPERATOR_WATCH_INTERVAL_MS=200

nohup bb "$SUPERVISOR_BB" "$ROOT" >> "$OP_DIR/operator-runtime-supervisor.log" 2>&1 &
LAUNCHER_JOB_PID=$!

SUP_PID=""
for _ in $(seq 1 50); do
  if [[ -f "$OP_DIR/operator-runtime-supervisor.pid" ]]; then
    SUP_PID="$(< "$OP_DIR/operator-runtime-supervisor.pid")"
    if [[ "$SUP_PID" =~ ^[0-9]+$ ]] && kill -0 "$SUP_PID" 2>/dev/null; then
      break
    fi
  fi
  sleep 0.1
done

if [[ -z "$SUP_PID" ]] || ! kill -0 "$SUP_PID" 2>/dev/null; then
  echo "FAIL: supervisor never claimed its own pid file"
  exit 1
fi

# Give the supervisor at least one full check cycle to see the fixture as
# healthy (seeded via initial-entry, never spawning) before killing it.
sleep 0.5

kill -TERM "$FAKE_OP_PID" 2>/dev/null || true
for _ in $(seq 1 20); do
  kill -0 "$FAKE_OP_PID" 2>/dev/null || break
  sleep 0.1
done

# One more interval so the supervisor's own loop has a chance to observe
# the death and (per invariant 3) keep running regardless.
sleep 0.5

if kill -0 "$SUP_PID" 2>/dev/null; then
  echo "PASS: the watch (pid $SUP_PID) is still running after the runtime it watches died"
  exit 0
else
  echo "FAIL: the watch process died alongside the runtime it watches"
  exit 1
fi
