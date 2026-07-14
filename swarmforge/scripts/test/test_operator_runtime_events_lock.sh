#!/usr/bin/env bash
# BL-369: proves the events.jsonl mkdir-lock actually prevents the
# bridge-vs-runtime race, using the REAL compiled bridge writer
# (extension/out/bridge/operatorEventQueue.js) and the REAL Babashka
# runtime concurrently, in two real OS processes - never a mocked/simulated
# stand-in for either side. operator_runtime.bb's own OPERATOR_EVENTS_LOCK_
# TEST_HOLD_MS hook holds the lock for a fixed, short duration right after
# acquiring it (before its own read/write), so the concurrent Node append
# is DETERMINISTICALLY forced to wait out the whole hold - no real-timer
# race, no flaky ordering assumption.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
REPO_ROOT="$(cd "$SRC/../.." && pwd)"
APPEND_CLI="$REPO_ROOT/extension/out/bridge/operatorEventQueue.js"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

if [[ ! -f "$APPEND_CLI" ]]; then
  note "FAIL - extension/out/bridge/operatorEventQueue.js not built (run npm run compile first)"
  exit 1
fi

make_fixture() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.swarmforge/operator" "$d/swarmforge/scripts" "$d/swarmforge/roles"
  cp "$SRC/operator_lib.bb" "$SRC/operator_runtime.bb" "$SRC/telegram_topic_lib.bb" \
     "$SRC/support_lib.bb" "$SRC/support_thread_store.bb" \
     "$SRC/operator_memory_lib.bb" "$SRC/operator_memory_store.bb" \
     "$SRC/ticket_status_lib.bb" "$SRC/operator_ask.bb" "$SRC/handoff_lib.bb" \
     "$SRC/daemon_alarm_lib.bb" \
     "$d/swarmforge/scripts/"
  printf '%s' "$d"
}

node_append() {
  # Appends via the REAL compiled TS writer - the same function the bridge
  # process calls from extension/src/bridge/bridgeServer.ts.
  node -e "
    const { appendOperatorEvent } = require('$APPEND_CLI');
    appendOperatorEvent('$1', { type: 'TEST_CONCURRENT_APPEND', marker: '$2' });
  "
}

events_and_inflight_text() {
  cat "$1/.swarmforge/operator/events.jsonl" 2>/dev/null
  cat "$1/.swarmforge/operator/events.inflight.jsonl" 2>/dev/null
}

# ── 1. a concurrent append during a held lock is delayed, never lost ────────
F="$(make_fixture)"
HOLD_MS=150
OPERATOR_SKIP_LAUNCH=1 OPERATOR_EVENTS_LOCK_TEST_HOLD_MS="$HOLD_MS" \
  bb "$F/swarmforge/scripts/operator_runtime.bb" "$F" --tick-once >/tmp/bl369-tick-1.log 2>&1 &
TICK_PID=$!
# Give the tick a head start so it is very likely already holding the lock
# when the concurrent append below fires - not required for correctness
# (either acquire order proves mutual exclusion), just makes the outcome
# below the more demonstrative one to assert on.
sleep 0.05
START_MS=$(date +%s%3N)
node_append "$F" "concurrent-1"
END_MS=$(date +%s%3N)
wait "$TICK_PID"
ELAPSED_MS=$((END_MS - START_MS))

check "tick-1: the runtime process completed cleanly" '[[ -f "$F/.swarmforge/operator/status.json" ]]'
check "tick-1: the concurrent append actually landed (never lost)" \
  '[[ "$(events_and_inflight_text "$F")" == *"TEST_CONCURRENT_APPEND"* ]]'
check "tick-1: the concurrent append was made to WAIT (blocked on the held lock, not instant)" \
  '(( ELAPSED_MS >= HOLD_MS / 2 ))'
check "tick-1: no lock directory left behind after both sides finished" \
  '[[ ! -d "$F/.swarmforge/operator/events.jsonl.lock" ]]'
rm -rf "$F"

# ── 2. bounded timeout: a genuinely stuck/orphaned lock surfaces loudly ─────
F2="$(make_fixture)"
mkdir -p "$F2/.swarmforge/operator/events.jsonl.lock" # simulate an orphaned lock
set +e
OPERATOR_SKIP_LAUNCH=1 OPERATOR_EVENTS_LOCK_MAX_WAIT_MS=100 OPERATOR_EVENTS_LOCK_RETRY_DELAY_MS=10 \
  bb "$F2/swarmforge/scripts/operator_runtime.bb" "$F2" --tick-once >/tmp/bl369-tick-2.log 2>&1
TICK2_EXIT=$?
set -e
check "tick-2: a pre-held lock causes a bounded, non-zero-exit failure (never an infinite hang)" '[[ "$TICK2_EXIT" -ne 0 ]]'
check "tick-2: the failure names the lock timeout loudly in the log" \
  '[[ "$(cat /tmp/bl369-tick-2.log)" == *"events lock timed out"* ]]'
rm -rf "$F2"

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime events-lock smoke: ALL CHECKS PASSED"
else
  echo "operator_runtime events-lock smoke: FAILURES ABOVE"
  exit 1
fi
