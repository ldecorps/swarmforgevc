#!/usr/bin/env bash
# BL-460: regression test for the bounded-SCAN wedge in fixture_reaper_sweep_lib.bb's
# sweep! (BL-458's own sibling of the sandbox-sweep wedge fixed by this same
# ticket) - see test_operator_runtime_sandbox_sweep_bounded_progress.sh's own
# header comment for the shared root cause. This test proves the fix: a
# per-tick cap smaller than the fixture, with reapable (orphaned-process)
# roots ordered AFTER the cap boundary, still get reaped within a bounded
# number of ticks - never against the real /tmp.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_project_fixture() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.swarmforge/operator" "$d/swarmforge/scripts" "$d/swarmforge/roles"
  cp "$SRC/operator_lib.bb" "$SRC/operator_runtime.bb" "$SRC/telegram_topic_lib.bb" \
     "$SRC/support_lib.bb" "$SRC/support_thread_store.bb" \
     "$SRC/operator_memory_lib.bb" "$SRC/operator_memory_store.bb" \
     "$SRC/ticket_status_lib.bb" "$SRC/operator_ask.bb" "$SRC/handoff_lib.bb" \
     "$SRC/daemon_alarm_lib.bb" "$SRC/disk_space_lib.bb" "$SRC/sandbox_sweep_lib.bb" "$SRC/bounded_delete_sweep_lib.bb" "$SRC/proc_fd_scan_lib.bb" \
     "$SRC/fixture_reaper_lib.bb" "$SRC/fixture_reaper_sweep_lib.bb" "$SRC/orphan_agent_reaper_lib.bb" "$SRC/orphan_agent_reaper_sweep_lib.bb" \
     "$d/swarmforge/scripts/"
  printf '%s' "$d"
}

LIVE_PIDS=()
cleanup() {
  for p in "${LIVE_PIDS[@]:-}"; do
    [[ -n "$p" ]] && kill -TERM "$p" 2>/dev/null || true
  done
}
trap cleanup EXIT

PROJECT="$(make_project_fixture)"
REAP_ROOT="$(mktemp -d)"
old_mtime() { touch -d "2 hours ago" "$1"; }

tick() {
  SWARMFORGE_FIXTURE_REAP_ROOT="$REAP_ROOT" SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS="" \
    SWARMFORGE_FIXTURE_REAP_STALE_HOURS=1 \
    SWARMFORGE_FIXTURE_REAP_MAX_PER_TICK=2 \
    SWARMFORGE_SANDBOX_SWEEP_ROOT="$PROJECT/.no-sandbox-sweep" \
    OPERATOR_SKIP_LAUNCH=1 \
    bb "$PROJECT/swarmforge/scripts/operator_runtime.bb" "$PROJECT" --tick-once > /dev/null
}

RUNTIME_LOG="$PROJECT/.swarmforge/operator/runtime.log"

# ── bounded-deletes-01/02: a cap of 2 with 2 fresh roots sorting FIRST,
#    then 3 stale orphaned roots sorting after them. ───────────────────────
mkdir -p "$REAP_ROOT/aps-a-fresh" "$REAP_ROOT/aps-b-fresh" \
  "$REAP_ROOT/aps-c-stale" "$REAP_ROOT/aps-d-stale" "$REAP_ROOT/aps-e-stale"

(cd "$REAP_ROOT/aps-c-stale" && exec sleep 30) & LIVE_PIDS+=("$!"); C_PID=$!
(cd "$REAP_ROOT/aps-d-stale" && exec sleep 30) & LIVE_PIDS+=("$!"); D_PID=$!
(cd "$REAP_ROOT/aps-e-stale" && exec sleep 30) & LIVE_PIDS+=("$!"); E_PID=$!

for _ in 1 2 3 4 5; do
  [[ -e "/proc/$C_PID/cwd" && -e "/proc/$D_PID/cwd" && -e "/proc/$E_PID/cwd" ]] && break
  sleep 0.1
done

old_mtime "$REAP_ROOT/aps-c-stale"
old_mtime "$REAP_ROOT/aps-d-stale"
old_mtime "$REAP_ROOT/aps-e-stale"
# a-fresh/b-fresh keep their just-created mtime.

tick # tick 1: window = [a-fresh, b-fresh] - neither reapable (fresh).
check "tick 1: neither fresh root is removed" \
  '[[ -e "$REAP_ROOT/aps-a-fresh" && -e "$REAP_ROOT/aps-b-fresh" ]]'
check "tick 1: no stale root reaped yet (window has not reached them)" \
  '[[ -e "$REAP_ROOT/aps-c-stale" && -e "$REAP_ROOT/aps-d-stale" && -e "$REAP_ROOT/aps-e-stale" ]]'
check "tick 1: a periodic nothing-found line was logged (streak 1)" \
  'grep -q "fixture-reaper-sweep scanned 2, nothing reaped (streak 1)" "$RUNTIME_LOG"'

sleep 0.3
tick # tick 2: cursor resumes after b-fresh -> window = [c-stale, d-stale].
check "tick 2: the orphaned processes rooted in c-stale/d-stale are killed" \
  '! kill -0 "$C_PID" 2>/dev/null && ! kill -0 "$D_PID" 2>/dev/null'
check "tick 2: AT MOST the per-tick cap (2) of reapable roots are removed" \
  '[[ ! -e "$REAP_ROOT/aps-c-stale" && ! -e "$REAP_ROOT/aps-d-stale" ]]'
check "tick 2: the third reapable root is NOT yet removed (beyond this tick's cap)" \
  '[[ -e "$REAP_ROOT/aps-e-stale" ]]'
check "tick 2: its orphaned process also survives (not yet examined)" \
  'kill -0 "$E_PID" 2>/dev/null'
check "tick 2: a reap-summary line was logged naming the count" \
  'grep -q "fixture-reaper-sweep reaped 2 of 2 scanned" "$RUNTIME_LOG"'

sleep 0.3
tick # tick 3: cursor resumes after d-stale -> window wraps and reaches e-stale.
check "BL-460 tmp-sweep-bounded-deletes-01/02: the remaining reapable root is removed within a bounded number of ticks" \
  '[[ ! -e "$REAP_ROOT/aps-e-stale" ]]'
check "the remaining orphaned process is killed too" \
  '! kill -0 "$E_PID" 2>/dev/null'
check "fresh roots survive the whole sequence (never falsely reaped)" \
  '[[ -e "$REAP_ROOT/aps-a-fresh" && -e "$REAP_ROOT/aps-b-fresh" ]]'

rm -rf "$PROJECT" "$REAP_ROOT"

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime fixture-reaper-sweep bounded-progress: ALL CHECKS PASSED"
else
  echo "operator_runtime fixture-reaper-sweep bounded-progress: FAILURES"; exit 1
fi
