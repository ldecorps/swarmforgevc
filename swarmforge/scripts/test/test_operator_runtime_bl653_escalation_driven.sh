#!/usr/bin/env bash
# BL-653: escalation-driven operator wake model — operator_runtime.bb must not
# manufacture SWARM_CHECK_TIMER / AGENT_EXITED; BABYSITTER_ESCALATION from the
# queue still launches exactly one run.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/operator_runtime_sandbox.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge/operator" "$d/swarmforge/scripts"
  copy_operator_runtime_sandbox "$SRC" "$d/swarmforge/scripts"
  cp "$SRC/operator_enqueue_event.bb" "$d/swarmforge/scripts/"
  printf '%s' "$d"
}

tick() {
  ( cd "$1" && \
    OPERATOR_SKIP_LAUNCH=1 SWARMFORGE_SANDBOX_SWEEP_ROOT="$1/.no-sandbox-sweep" SWARMFORGE_FIXTURE_REAP_ROOT="$1/.no-fixture-reap" SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS="" \
      bb "$1/swarmforge/scripts/operator_runtime.bb" "$1" --tick-once )
}

launch_count() {
  local n=0
  [[ -f "$1/.swarmforge/operator/events.inflight.jsonl" ]] && n=$((n + 1))
  [[ -d "$1/.swarmforge/operator/events-done" ]] && n=$((n + $(ls "$1/.swarmforge/operator/events-done/" 2>/dev/null | wc -l)))
  printf '%s' "$n"
}

events_text() {
  cat "$1/.swarmforge/operator/events.jsonl" 2>/dev/null || true
  cat "$1/.swarmforge/operator/events.inflight.jsonl" 2>/dev/null || true
}

# ── 01: healthy idle night — zero launches ───────────────────────────────────
F1="$(make_fixture)"
OUT1="$(tick "$F1")"
check "BL-653-01: idle tick does not launch" '[[ "$OUT1" == *"\"launched?\":false"* ]]'
check "BL-653-01: no SWARM_CHECK_TIMER" '[[ "$(events_text "$F1")" != *"SWARM_CHECK_TIMER"* ]]'
check "BL-653-01: launch count zero" '[[ "$(launch_count "$F1")" -eq 0 ]]'
rm -rf "$F1"

# ── 02: TELEGRAM_TOPIC_MESSAGE wakes exactly one run ─────────────────────────
F2="$(make_fixture)"
printf '{"type":"TELEGRAM_TOPIC_MESSAGE","subject":"SUP-1"}\n' > "$F2/.swarmforge/operator/events.jsonl"
OUT2="$(tick "$F2")"
check "BL-653-02: telegram message launches once" '[[ "$OUT2" == *"\"launched?\":true"* ]]'
check "BL-653-02: inflight carries SUP-1" 'grep -q "SUP-1" "$F2/.swarmforge/operator/events.inflight.jsonl"'
rm -rf "$F2"

# ── 03: BABYSITTER_ESCALATION with finding text ────────────────────────────────
F3="$(make_fixture)"
bb "$F3/swarmforge/scripts/operator_enqueue_event.bb" "$F3" \
  '{"type":"BABYSITTER_ESCALATION","subject":"proc-coder","detail":"resident process missing"}'
OUT3="$(tick "$F3")"
check "BL-653-03: escalation launches once" '[[ "$OUT3" == *"\"launched?\":true"* ]]'
check "BL-653-03: finding text in inflight batch" \
  'grep -q "resident process missing" "$F3/.swarmforge/operator/events.inflight.jsonl"'
rm -rf "$F3"

# ── 06: SWARM_CONTROL_LOST unchanged ─────────────────────────────────────────
F6="$(make_fixture)"
printf '{"type":"SWARM_CONTROL_LOST","detail":"socket gone"}\n' > "$F6/.swarmforge/operator/events.jsonl"
OUT6="$(tick "$F6")"
check "BL-653-06: SWARM_CONTROL_LOST launches once" '[[ "$OUT6" == *"\"launched?\":true"* ]]'
check "BL-653-06: event present in inflight" \
  'grep -q "SWARM_CONTROL_LOST" "$F6/.swarmforge/operator/events.inflight.jsonl"'
rm -rf "$F6"

# ── 08: tracked repo must not ship operator pid-hold tourniquet scripts ────────
check "BL-653-08: no pid-hold tourniquet in tracked swarmforge scripts" \
  '! grep -Rqi "pid-hold\|pid_hold\|operator pid hold" "$SRC" --exclude="test_operator_runtime_bl653_escalation_driven.sh" 2>/dev/null'

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime BL-653 escalation-driven: ALL CHECKS PASSED"
else
  echo "operator_runtime BL-653 escalation-driven: FAILURES ABOVE"
  exit 1
fi
