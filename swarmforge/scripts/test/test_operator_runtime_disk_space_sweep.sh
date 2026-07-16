#!/usr/bin/env bash
# BL-412: wiring smoke test for operator_runtime.bb's disk-space-sweep!.
# Drives a real --tick-once with df reads REPLACED by the injectable
# DISK_ALERT_<MOUNT>_FORCE_RESULT seam (the same test-only JSON-override
# convention as OPERATOR_ALARM_FORCE_RESULT) - never a real df call, never a
# real read of /mnt/c, matching the ticket's own explicit testability rule.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.swarmforge/operator" "$d/swarmforge/scripts" "$d/swarmforge/roles"
  cp "$SRC/operator_lib.bb" "$SRC/operator_runtime.bb" "$SRC/telegram_topic_lib.bb" \
     "$SRC/support_lib.bb" "$SRC/support_thread_store.bb" \
     "$SRC/operator_memory_lib.bb" "$SRC/operator_memory_store.bb" \
     "$SRC/ticket_status_lib.bb" "$SRC/operator_ask.bb" "$SRC/handoff_lib.bb" \
     "$SRC/daemon_alarm_lib.bb" "$SRC/disk_space_lib.bb" "$SRC/sandbox_sweep_lib.bb" \
     "$d/swarmforge/scripts/"
  printf '%s' "$d"
}

HEALTHY='{"free_gb":200,"used_pct":30}'
CRITICAL_MNT_C='{"free_gb":10,"used_pct":97}'

tick() {
  local root="$1" mnt_c="$2" wsl_root="$3"
  OPERATOR_SKIP_LAUNCH=1 \
    DISK_ALERT_MNT_C_FORCE_RESULT="$mnt_c" \
    DISK_ALERT_WSL_ROOT_FORCE_RESULT="$wsl_root" \
    bb "$root/swarmforge/scripts/operator_runtime.bb" "$root" --tick-once > /dev/null
}

outbox_text() { cat "$1/.swarmforge/operator/telegram-reply-outbox.jsonl" 2>/dev/null; }
state_json() { cat "$1/.swarmforge/operator/disk-space-state.json" 2>/dev/null; }

# ── 1. a critical reading on /mnt/c delivers exactly one alert, naming the
#      mount, and persists the critical level ───────────────────────────────
F="$(make_fixture)"
tick "$F" "$CRITICAL_MNT_C" "$HEALTHY"
OUT="$(outbox_text "$F")"
check "an alert was delivered to the operator reply-outbox" \
  '[[ -n "$OUT" ]]'
check "the alert names the OPERATOR thread (standing Operator topic)" \
  '[[ "$OUT" == *"\"threadId\":\"OPERATOR\""* ]]'
check "the alert names the mount /mnt/c" \
  '[[ "$OUT" == *"/mnt/c"* ]]'
check "the persisted state records mnt-c as critical" \
  '[[ "$(state_json "$F")" == *"\"mnt-c\":\"critical\""* ]]'
check "the persisted state records wsl-root as healthy" \
  '[[ "$(state_json "$F")" == *"\"wsl-root\":\"healthy\""* ]]'

# ── 2. a second tick at the SAME critical reading delivers NO new message
#      (change-gated - BL-394 lesson) ───────────────────────────────────────
LINES_BEFORE="$(wc -l < "$F/.swarmforge/operator/telegram-reply-outbox.jsonl")"
tick "$F" "$CRITICAL_MNT_C" "$HEALTHY"
LINES_AFTER="$(wc -l < "$F/.swarmforge/operator/telegram-reply-outbox.jsonl")"
check "an unchanged critical level adds no new outbox line" \
  '[[ "$LINES_AFTER" -eq "$LINES_BEFORE" ]]'
rm -rf "$F"

# ── 3. recovery: back to healthy delivers one recovery alert ───────────────
F="$(make_fixture)"
tick "$F" "$CRITICAL_MNT_C" "$HEALTHY"
tick "$F" "$HEALTHY" "$HEALTHY"
OUT3="$(outbox_text "$F")"
LINE_COUNT="$(wc -l < "$F/.swarmforge/operator/telegram-reply-outbox.jsonl")"
check "recovery adds exactly one more alert line (2 total: critical then recovery)" \
  '[[ "$LINE_COUNT" -eq 2 ]]'
check "the state now records mnt-c as healthy again" \
  '[[ "$(state_json "$F")" == *"\"mnt-c\":\"healthy\""* ]]'
rm -rf "$F"

# ── 4. each filesystem is evaluated independently ───────────────────────────
F="$(make_fixture)"
tick "$F" "$HEALTHY" "$CRITICAL_MNT_C"
OUT4="$(outbox_text "$F")"
LINE_COUNT4="$(wc -l < "$F/.swarmforge/operator/telegram-reply-outbox.jsonl")"
check "exactly one alert (only wsl-root crossed a threshold)" \
  '[[ "$LINE_COUNT4" -eq 1 ]]'
check "the alert is for the WSL root, not /mnt/c" \
  '[[ "$OUT4" == *"WSL root"* ]]'
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime disk-space-sweep smoke: ALL CHECKS PASSED"
else
  echo "operator_runtime disk-space-sweep smoke: FAILURES"; exit 1
fi
