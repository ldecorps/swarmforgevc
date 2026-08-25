#!/usr/bin/env bash
# BL-993 hardening: swarm_status.bb's operator-runtime row (gather-operator-
# runtime) was rewired to call operator_runtime_watch_lib.bb's healthy? (pid
# liveness AND command line) instead of the bare pid-alive? every other
# daemon row here uses - closing the pid-reuse gap (backlog/evidence/
# BL-993-bounce-20260820.md). Nothing exercised the CLI wiring itself: the
# lib's healthy?/runtime-alive? predicate is unit- and property-tested, but
# a wrong project-root, a wrong key, or a reverted call site in
# swarm_status.bb would not fail either of those - only running the real
# `swarm_status.bb <root>` against a pid-reuse fixture can.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
STATUS_BB="$SRC/swarm_status.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOTS=""
SPAWNED_PIDS=""
cleanup() {
  for p in $SPAWNED_PIDS; do
    kill -0 "$p" 2>/dev/null && kill -TERM "$p" 2>/dev/null
  done
  for r in $ROOTS; do
    rm -rf "$r"
  done
}
trap cleanup EXIT

make_root() {
  local d
  d="$(mktemp -d)"
  ROOTS="$ROOTS $d"
  mkdir -p "$d/.swarmforge/operator" "$d/.swarmforge/daemon"
  printf '%s' "$d"
}

operator_line() {
  bb "$STATUS_BB" "$1" 2>/dev/null | grep 'operator-runtime'
}

# 1) No pidfile at all -> DOWN.
ROOT="$(make_root)"
LINE="$(operator_line "$ROOT")"
grep -q 'DOWN' <<< "$LINE" || fail "no-pidfile: expected DOWN, got: $LINE"
pass "no pidfile: operator-runtime reports DOWN"

# 2) A live but UNRELATED process's pid (pid reuse) -> DOWN with stale-pid,
#    never UP. This is the exact case a bare kill-0/daemon-from-pid gets
#    wrong and the one this parcel's rewiring exists to fix.
ROOT="$(make_root)"
sleep 60 &
UNREL_PID=$!
SPAWNED_PIDS="$SPAWNED_PIDS $UNREL_PID"
echo "$UNREL_PID" > "$ROOT/.swarmforge/operator/runtime.pid"
LINE="$(operator_line "$ROOT")"
grep -q 'DOWN' <<< "$LINE" || fail "pid-reuse: expected DOWN, got: $LINE"
grep -q 'stale-pid' <<< "$LINE" || fail "pid-reuse: expected stale-pid detail, got: $LINE"
kill -TERM "$UNREL_PID" 2>/dev/null || true
pass "pid reuse (live unrelated process): operator-runtime reports DOWN/stale-pid"

# 3) A real operator_runtime.bb-shaped process -> UP, no stale-pid.
ROOT="$(make_root)"
bb -e '(Thread/sleep 60000)' operator_runtime.bb >/dev/null 2>&1 &
REAL_PID=$!
SPAWNED_PIDS="$SPAWNED_PIDS $REAL_PID"
sleep 0.3
echo "$REAL_PID" > "$ROOT/.swarmforge/operator/runtime.pid"
LINE="$(operator_line "$ROOT")"
grep -q 'UP' <<< "$LINE" || fail "real process: expected UP, got: $LINE"
grep -q 'stale-pid' <<< "$LINE" && fail "real process: unexpected stale-pid, got: $LINE"
kill -TERM "$REAL_PID" 2>/dev/null || true
pass "real operator_runtime.bb process: operator-runtime reports UP, no stale-pid"

echo "ALL PASS: test_swarm_status_operator_runtime.sh"
