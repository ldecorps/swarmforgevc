#!/usr/bin/env bash
# BL-993: stop_operator_runtime (stop_ancillary_services.sh) now stops the
# always-on watch (operator-runtime-supervisor.pid) BEFORE the runtime it
# supervises - a watch left running during a deliberate stop would see the
# runtime disappear moments later and restart it through the exact same
# decide()/deliberately-stopped? path invariant 1 already guards, undoing
# the stop (comment at stop_operator_runtime, BL-993). Nothing exercised
# this: before this ticket there was no supervisor pidfile to stop at all,
# and no test here spawns one.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
SPAWNED_PIDS=""
cleanup() {
  for p in $SPAWNED_PIDS; do
    kill -0 "$p" 2>/dev/null && kill -TERM "$p" 2>/dev/null
  done
  rm -rf "$ROOT"
}
trap cleanup EXIT

OP_DIR="$ROOT/.swarmforge/operator"
mkdir -p "$OP_DIR"

# Fake supervisor and fake runtime - real processes with distinct pids, no
# argv/behavior needed since stop_operator_runtime only signals by pidfile.
sleep 300 &
SUP_PID=$!
SPAWNED_PIDS="$SPAWNED_PIDS $SUP_PID"
echo "$SUP_PID" > "$OP_DIR/operator-runtime-supervisor.pid"

sleep 300 &
RUNTIME_PID=$!
SPAWNED_PIDS="$SPAWNED_PIDS $RUNTIME_PID"
echo "$RUNTIME_PID" > "$OP_DIR/runtime.pid"

kill -0 "$SUP_PID" 2>/dev/null || fail "setup: fake supervisor did not start"
kill -0 "$RUNTIME_PID" 2>/dev/null || fail "setup: fake runtime did not start"

source "$SRC/stop_ancillary_services.sh"
stop_ancillary_init "$ROOT"
stop_operator_runtime

kill -0 "$SUP_PID" 2>/dev/null && fail "supervisor pid $SUP_PID is still alive after stop_operator_runtime"
pass "supervisor (the always-on watch) is stopped"

kill -0 "$RUNTIME_PID" 2>/dev/null && fail "runtime pid $RUNTIME_PID is still alive after stop_operator_runtime"
pass "operator runtime is stopped"

[[ -f "$OP_DIR/operator-runtime-supervisor.pid" ]] && fail "supervisor pidfile not removed"
[[ -f "$OP_DIR/runtime.pid" ]] && fail "runtime pidfile not removed"
[[ -f "$OP_DIR/operator-runtime-supervisor.stop" ]] && fail "supervisor stop-file not cleared"
[[ -f "$OP_DIR/stop" ]] && fail "runtime stop-file not cleared"
pass "all pidfiles and stop-files cleared"

echo "ALL PASS: test_stop_operator_runtime_watch_first.sh"
