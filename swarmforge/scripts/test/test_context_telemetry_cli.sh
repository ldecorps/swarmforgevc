#!/usr/bin/env bash
# Shell smoke tests for the Context Telemetry store+CLI (GH-22 Slice 1):
# context_telemetry_cli.bb driven end to end against an isolated state dir
# via CONTEXT_TELEMETRY_STATE_DIR, so this never mutates the repo's real
# .swarmforge/telemetry/. Pure decisions are covered by
# context_telemetry_test_runner.bb instead — this exercises the fs adapter
# (append, read-back) and the CLI's own arg parsing/validation/output
# formatting.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI="$ROOT/swarmforge/scripts/context_telemetry_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

STATE_DIR="$(mktemp -d)"
trap 'rm -rf "$STATE_DIR"' EXIT
export CONTEXT_TELEMETRY_STATE_DIR="$STATE_DIR"

# ── 1: pure context_telemetry_lib tests (bb) ────────────────────────────────
bb "$SCRIPT_DIR/context_telemetry_test_runner.bb" | grep -q "^ALL PASS$" \
  || fail "01: context_telemetry_test_runner.bb did not report ALL PASS"

pass "01: context_telemetry_lib pure tests"

# ── 2: the log starts empty, record creates it on first write ──────────────
[[ -f "$STATE_DIR/context-events.jsonl" ]] && fail "02: log file should not exist before the first record"
bb "$CLI" record --agent coder --role coder --session-id sess-1 --timestamp 2026-01-01T00:00:00Z \
  --input-tokens 12000 --output-tokens 400 --context-utilization-pct 42 --provider anthropic --model claude-sonnet-5 \
  >/dev/null
[[ -f "$STATE_DIR/context-events.jsonl" ]] || fail "02: record did not create the log file"
[[ "$(wc -l < "$STATE_DIR/context-events.jsonl")" -eq 1 ]] || fail "02: expected exactly one line after one record"

pass "02: record creates the log on first write and appends one line"

# ── 3: recorded event round-trips its values ────────────────────────────────
LINE="$(cat "$STATE_DIR/context-events.jsonl")"
[[ "$LINE" == *'"agent":"coder"'* ]] || fail "03: recorded event missing agent"
[[ "$LINE" == *'"input_tokens":12000.0'* ]] || fail "03: recorded event missing input_tokens"
[[ "$LINE" == *'"context_utilization_pct":42.0'* ]] || fail "03: recorded event missing context_utilization_pct"
[[ "$LINE" == *'"compaction":false'* ]] || fail "03: recorded event should default compaction to false"

pass "03: recorded event round-trips agent/input_tokens/context_utilization_pct/compaction"

# ── 4: a compaction event is recorded with compaction:true ─────────────────
bb "$CLI" record --agent coder --role coder --session-id sess-1 --timestamp 2026-01-01T00:00:05Z \
  --input-tokens 20000 --output-tokens 500 --context-utilization-pct 90 --provider anthropic --model claude-sonnet-5 \
  --compaction true >/dev/null
[[ "$(wc -l < "$STATE_DIR/context-events.jsonl")" -eq 2 ]] || fail "04: expected two lines after a second record"
tail -1 "$STATE_DIR/context-events.jsonl" | grep -q '"compaction":true' \
  || fail "04: second recorded event should carry compaction:true"

pass "04: an explicit --compaction true is recorded and persisted"

# ── 5: summary aggregates compaction count, average utilisation, and ttfc ──
SUMMARY_OUT="$(bb "$CLI" summary --agent coder)"
[[ "$SUMMARY_OUT" == *'"event_count":2'* ]] || fail "05: summary event_count should be 2"
[[ "$SUMMARY_OUT" == *'"compaction_count":1'* ]] || fail "05: summary compaction_count should be 1"
[[ "$SUMMARY_OUT" == *'"avg_context_utilization_pct":66'* ]] || fail "05: summary avg_context_utilization_pct should be (42+90)/2=66"
[[ "$SUMMARY_OUT" == *'"time_to_first_compaction_ms":5000'* ]] || fail "05: summary time_to_first_compaction_ms should be 5000"

pass "05: summary aggregates compaction count, average utilisation, and time-to-first-compaction"

# ── 6: summary scopes strictly to the requested agent ───────────────────────
bb "$CLI" record --agent hardener --role hardener --session-id sess-9 --timestamp 2026-01-01T00:00:00Z \
  --input-tokens 1000 --output-tokens 100 --context-utilization-pct 10 --provider anthropic --model claude-sonnet-5 \
  >/dev/null
HARDENER_SUMMARY="$(bb "$CLI" summary --agent hardener)"
[[ "$HARDENER_SUMMARY" == *'"event_count":1'* ]] || fail "06: hardener summary should only see its own event"
[[ "$HARDENER_SUMMARY" != *'"compaction_count":1'* ]] || fail "06: hardener summary should not see coder's compaction"

pass "06: summary scopes strictly to the requested --agent"

# ── 7: a non-numeric token count is rejected and the log is untouched ──────
LINES_BEFORE="$(wc -l < "$STATE_DIR/context-events.jsonl")"
bb "$CLI" record --agent coder --role coder --session-id sess-1 --timestamp 2026-01-01T00:00:06Z \
  --input-tokens not-a-number --output-tokens 400 --context-utilization-pct 42 --provider anthropic --model claude-sonnet-5 \
  >$STATE_DIR/malformed.out 2>&1 && fail "07: record should exit non-zero for a non-numeric input-tokens" || true
grep -q "non-numeric value for field: input_tokens" $STATE_DIR/malformed.out \
  || fail "07: record did not report the non-numeric field by name"
LINES_AFTER="$(wc -l < "$STATE_DIR/context-events.jsonl")"
[[ "$LINES_AFTER" -eq "$LINES_BEFORE" ]] || fail "07: log line count changed after a rejected record"
rm -f $STATE_DIR/malformed.out

pass "07: a non-numeric field is rejected without touching the log"

# ── 7b: a non-finite numeric string (NaN/Infinity) is rejected too ─────────
bb "$CLI" record --agent coder --role coder --session-id sess-1 --timestamp 2026-01-01T00:00:07Z \
  --input-tokens Infinity --output-tokens 400 --context-utilization-pct 42 --provider anthropic --model claude-sonnet-5 \
  >$STATE_DIR/nonfinite.out 2>&1 && fail "07b: record should exit non-zero for a non-finite input-tokens" || true
grep -q "non-numeric value for field: input_tokens" $STATE_DIR/nonfinite.out \
  || fail "07b: record did not report the non-finite field by name"
LINES_AFTER_NONFINITE="$(wc -l < "$STATE_DIR/context-events.jsonl")"
[[ "$LINES_AFTER_NONFINITE" -eq "$LINES_BEFORE" ]] || fail "07b: log line count changed after a rejected non-finite record"
rm -f $STATE_DIR/nonfinite.out

pass "07b: a non-finite numeric string (Infinity) is rejected without touching the log"

# ── 8: a missing required field is rejected and the log is untouched ───────
bb "$CLI" record --agent coder --role coder --session-id sess-1 \
  --input-tokens 100 --output-tokens 400 --context-utilization-pct 42 --provider anthropic --model claude-sonnet-5 \
  >$STATE_DIR/missing.out 2>&1 && fail "08: record should exit non-zero when --timestamp is missing" || true
grep -q "missing required field: timestamp" $STATE_DIR/missing.out \
  || fail "08: record did not report the missing field by name"
LINES_AFTER_2="$(wc -l < "$STATE_DIR/context-events.jsonl")"
[[ "$LINES_AFTER_2" -eq "$LINES_BEFORE" ]] || fail "08: log line count changed after a rejected record"
rm -f $STATE_DIR/missing.out

pass "08: a missing required field is rejected without touching the log"

# ── 9: an unrecognised command falls through to usage and exits non-zero ───
bb "$CLI" bogus-command >$STATE_DIR/usage.out 2>&1 && fail "09: an unrecognised command should exit non-zero" || true
grep -q "^Usage: context_telemetry_cli.bb" $STATE_DIR/usage.out \
  || fail "09: unrecognised command did not print usage"
rm -f $STATE_DIR/usage.out

pass "09: an unrecognised command falls through to usage"

echo "ALL PASS"
