#!/usr/bin/env bash
# BL-369 no-inbound-message-is-ever-lost-04: "a message recorded in a
# thread's transcript but never queued is reclaimed". Hand-plants a thread
# message with an updateId but no eventQueued flag (exactly what a crash
# between the bridge's transcript write and its enqueue leaves behind) and
# proves the tick's own reconcile-unqueued-messages! sweep reclaims it -
# and that a second sweep is a pure no-op (idempotent, never a double wake).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.swarmforge/operator" "$d/swarmforge/scripts" "$d/swarmforge/roles" "$d/.swarmforge/support/threads"
  cp "$SRC/operator_lib.bb" "$SRC/operator_runtime.bb" "$SRC/telegram_topic_lib.bb" \
     "$SRC/support_lib.bb" "$SRC/support_thread_store.bb" \
     "$SRC/operator_memory_lib.bb" "$SRC/operator_memory_store.bb" \
     "$SRC/ticket_status_lib.bb" "$SRC/operator_ask.bb" "$SRC/handoff_lib.bb" \
     "$SRC/daemon_alarm_lib.bb" \
     "$d/swarmforge/scripts/"
  printf '%s' "$d"
}
tick() { OPERATOR_SKIP_LAUNCH=1 bb "$1/swarmforge/scripts/operator_runtime.bb" "$1" --tick-once; }

events_and_inflight_text() {
  cat "$1/.swarmforge/operator/events.jsonl" 2>/dev/null
  cat "$1/.swarmforge/operator/events.inflight.jsonl" 2>/dev/null
  # Also scan archived batches - a tick that skips the real LLM launch
  # (OPERATOR_SKIP_LAUNCH=1) still reaps+archives the inflight batch on
  # the VERY NEXT tick (operator-running? is false with no real process),
  # so an event dispatched on tick-1 has moved into events-done/ by the
  # time tick-2 finishes - a real total across the queue's full lifecycle,
  # not just its two live-file snapshots.
  find "$1/.swarmforge/operator" -path '*-done/*.jsonl' -exec cat {} \; 2>/dev/null
}

count_matches() {
  events_and_inflight_text "$1" | grep -c "$2" || true
}

F="$(make_fixture)"
cat > "$F/.swarmforge/support/threads/SUP-1.json" <<'EOF'
{"id":"SUP-1","status":"open","messages":[
  {"channel":"telegram","timestamp":"2026-07-14T00:00:00Z","text":"never woken for","updateId":900}
]}
EOF

OUT1="$(tick "$F")"
check "tick-1: the reconcile sweep ran (tick reports success)" '[[ "$OUT1" == *"\"launched?\""* ]]'
check "tick-1: an Operator wake was queued for the reclaimed message" \
  '(( $(count_matches "$F" "TELEGRAM_TOPIC_MESSAGE") >= 1 ))'
check "tick-1: the queued event names the right subject and updateId" \
  '(( $(count_matches "$F" "\"subject\":\"SUP-1\"") >= 1 )) && (( $(count_matches "$F" "\"updateId\":900") >= 1 ))'

THREAD_AFTER_1="$(cat "$F/.swarmforge/support/threads/SUP-1.json")"
check "tick-1: the thread message is now marked eventQueued:true" '[[ "$THREAD_AFTER_1" == *"\"eventQueued\":true"* ]]'

BEFORE_SECOND_COUNT="$(count_matches "$F" "TELEGRAM_TOPIC_MESSAGE")"
OUT2="$(tick "$F")"
AFTER_SECOND_COUNT="$(count_matches "$F" "TELEGRAM_TOPIC_MESSAGE")"
check "tick-2: a second sweep reclaims nothing new (idempotent, never a double wake)" \
  '[[ "$BEFORE_SECOND_COUNT" -eq "$AFTER_SECOND_COUNT" ]]'

rm -rf "$F"

# ── a message that IS already queued is left alone entirely ────────────────
F2="$(make_fixture)"
cat > "$F2/.swarmforge/support/threads/SUP-2.json" <<'EOF'
{"id":"SUP-2","status":"open","messages":[
  {"channel":"telegram","timestamp":"2026-07-14T00:00:00Z","text":"already handled","updateId":901,"eventQueued":true}
]}
EOF
tick "$F2" >/dev/null
check "an already-queued message is never re-enqueued by the sweep" \
  '(( $(count_matches "$F2" "\"updateId\":901") == 0 ))'
rm -rf "$F2"

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime reconcile-unqueued smoke: ALL CHECKS PASSED"
else
  echo "operator_runtime reconcile-unqueued smoke: FAILURES ABOVE"
  exit 1
fi
