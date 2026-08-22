#!/usr/bin/env bash
# BL-823: unit tests for availability_ledger_lib.sh - the shell write side
# of the swarm availability interval ledger (the twin of
# extension/src/metrics/availabilityLedgerStore.ts, sourced by
# kill_pipeline_swarm.sh and start-swarm.sh).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
LIB="$SRC/availability_ledger_lib.sh"

fail=0
note() { printf '%s\n' "$*"; }
check() {
  if eval "$2"; then
    note "ok   - $1"
  else
    note "FAIL - $1"
    fail=1
  fi
}
pass() { note "PASS: $*"; }

make_root() {
  local d
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  printf '%s' "$d"
}

# shellcheck disable=SC1090
source "$LIB"

ledger_file() {
  # $1=root $2=month
  availability_ledger_file "$1" "$2"
}

# ── 01: append writes one {ts,event,class,source} line ─────────────────────
ROOT="$(make_root)"
availability_record "$ROOT" "pause-start" "control-pause" "test-source" "2026-08-06T01:00:00Z"
LINE="$(cat "$(ledger_file "$ROOT" "2026-08")")"
check "01: record file exists at the monthly path" \
  '[[ -f "$(ledger_file "$ROOT" "2026-08")" ]]'
check "01: line carries the event" \
  '[[ "$LINE" == *"\"event\":\"pause-start\""* ]]'
check "01: line carries the class" \
  '[[ "$LINE" == *"\"class\":\"control-pause\""* ]]'
check "01: line names its source" \
  '[[ "$LINE" == *"\"source\":\"test-source\""* ]]'
pass "01: availability_record appends one well-formed record"

# ── append-only across calls, routed by month ───────────────────────────────
ROOT="$(make_root)"
availability_record "$ROOT" "stop" "swarm-stop" "kill_pipeline_swarm.sh" "2026-08-31T23:00:00Z"
availability_record "$ROOT" "start" "swarm-stop" "start-swarm.sh" "2026-09-01T01:00:00Z"
check "month-boundary: august file has exactly one line" \
  '[[ "$(wc -l < "$(ledger_file "$ROOT" "2026-08")" | tr -d " ")" == "1" ]]'
check "month-boundary: september file has exactly one line" \
  '[[ "$(wc -l < "$(ledger_file "$ROOT" "2026-09")" | tr -d " ")" == "1" ]]'
pass "each record routes to the ledger file matching its own month"

# ── 05: a ledger write failure never blocks the caller ─────────────────────
# A directory sitting at the exact ledger file path is the established,
# portable EISDIR-style failure simulation this codebase uses - never chmod
# (engineering rule).
ROOT="$(make_root)"
mkdir -p "$(ledger_file "$ROOT" "2026-08")"
set +e
availability_record "$ROOT" "stop" "swarm-stop" "kill_pipeline_swarm.sh" "2026-08-06T01:00:00Z"
RC=$?
set -e
check "05: availability_record returns success even when the ledger cannot be written" \
  '[[ "$RC" -eq 0 ]]'
pass "05: a ledger write failure never fails or blocks the caller"

# ── availability_last_event ──────────────────────────────────────────────
ROOT="$(make_root)"
check "last-event: empty ledger has no last event" \
  '[[ -z "$(availability_last_event "$ROOT")" ]]'
availability_record "$ROOT" "start" "swarm-stop" "start-swarm.sh" "2026-08-06T00:00:00Z"
check "last-event: reads the single record's event" \
  '[[ "$(availability_last_event "$ROOT")" == "start" ]]'
availability_record "$ROOT" "stop" "swarm-stop" "kill_pipeline_swarm.sh" "2026-08-06T01:00:00Z"
check "last-event: reads the MOST RECENT record's event" \
  '[[ "$(availability_last_event "$ROOT")" == "stop" ]]'
pass "availability_last_event reads the newest record across the ledger"

# ── scenario 03: ungraceful stop closed at the daemon's last heartbeat ─────
ROOT="$(make_root)"
availability_record "$ROOT" "start" "swarm-stop" "start-swarm.sh" "2026-08-06T00:00:00Z"
HEARTBEAT="$ROOT/handoffd.heartbeat"
printf '2026-08-06T01:00:00Z' > "$HEARTBEAT"
availability_close_ungraceful_stop "$ROOT" "$HEARTBEAT"
LINES="$(cat "$(ledger_file "$ROOT" "2026-08")")"
check "03: a synthetic stop record is appended at the heartbeat's own tick" \
  'echo "$LINES" | grep -q "\"event\":\"stop\".*\"ts\":\"2026-08-06T01:00:00Z\"\|\"ts\":\"2026-08-06T01:00:00Z\".*\"event\":\"stop\""'
check "03: the synthetic stop is sourced as heartbeat-inferred" \
  'echo "$LINES" | grep -q "\"event\":\"stop\"" && echo "$LINES" | grep "\"event\":\"stop\"" | grep -q "heartbeat-inferred"'
pass "03: an ungraceful stop is closed at the daemon's last heartbeat"

# ── scenario 04: no heartbeat evidence emits nothing ────────────────────────
ROOT="$(make_root)"
availability_record "$ROOT" "start" "swarm-stop" "start-swarm.sh" "2026-08-06T00:00:00Z"
availability_close_ungraceful_stop "$ROOT" "$ROOT/no-such-heartbeat"
check "04: no synthetic stop is appended without heartbeat evidence" \
  '[[ "$(wc -l < "$(ledger_file "$ROOT" "2026-08")" | tr -d " ")" == "1" ]]'
pass "04: an ungraceful stop with no heartbeat evidence emits nothing"

# ── heartbeat older than (or equal to) the open interval's own start: skip ──
ROOT="$(make_root)"
availability_record "$ROOT" "start" "swarm-stop" "start-swarm.sh" "2026-08-06T02:00:00Z"
HEARTBEAT2="$ROOT/handoffd.heartbeat"
printf '2026-08-06T01:00:00Z' > "$HEARTBEAT2"
availability_close_ungraceful_stop "$ROOT" "$HEARTBEAT2"
check "stale heartbeat (older than the open start) emits nothing" \
  '[[ "$(wc -l < "$(ledger_file "$ROOT" "2026-08")" | tr -d " ")" == "1" ]]'
pass "a heartbeat no newer than the still-open start is treated as no evidence"

# ── a graceful stop already on record: no synthetic close ──────────────────
ROOT="$(make_root)"
availability_record "$ROOT" "stop" "swarm-stop" "kill_pipeline_swarm.sh" "2026-08-06T01:00:00Z"
HEARTBEAT3="$ROOT/handoffd.heartbeat"
printf '2026-08-06T05:00:00Z' > "$HEARTBEAT3"
availability_close_ungraceful_stop "$ROOT" "$HEARTBEAT3"
check "a graceful stop already on record is never closed again" \
  '[[ "$(wc -l < "$(ledger_file "$ROOT" "2026-08")" | tr -d " ")" == "1" ]]'
pass "the last record already being a stop is a no-op for the ungraceful close"

if [[ "$fail" -ne 0 ]]; then
  note "FAILURES DETECTED"
  exit 1
fi
note "ALL PASS: availability_ledger_lib.sh"
