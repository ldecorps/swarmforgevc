#!/usr/bin/env bash
# BL-460: regression test for the bounded-SCAN wedge - the OLD sandbox-sweep!
# always started its `take max-per-tick` window at the SAME fixed position
# every tick, so a listing whose first `cap` entries never contained a
# reapable one re-scanned that dead window FOREVER (live: 0 of the first 100
# /tmp entries were reapable, 76 orphans untouched at 21h). This test proves
# the FIX: a per-tick cap that is smaller than the fixture, with reapable
# entries ordered AFTER the cap boundary, still get removed within a bounded
# number of ticks - never against the real /tmp (SWARMFORGE_SANDBOX_SWEEP_ROOT
# isolates every tick to a private fixture dir).
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
     "$SRC/daemon_alarm_lib.bb" "$SRC/disk_space_lib.bb" "$SRC/sandbox_sweep_lib.bb" "$SRC/bounded_delete_sweep_lib.bb" "$SRC/proc_fd_scan_lib.bb" "$SRC/fixture_reaper_lib.bb" "$SRC/fixture_reaper_sweep_lib.bb" \
     "$d/swarmforge/scripts/"
  printf '%s' "$d"
}

PROJECT="$(make_project_fixture)"
SANDBOX_ROOT="$(mktemp -d)"
old_mtime() { touch -d "2 hours ago" "$1"; }

tick() {
  SWARMFORGE_SANDBOX_SWEEP_ROOT="$SANDBOX_ROOT" \
    SWARMFORGE_SANDBOX_STALE_HOURS=1 \
    SWARMFORGE_SANDBOX_SWEEP_MAX_PER_TICK=2 \
    SWARMFORGE_FIXTURE_REAP_ROOT="$PROJECT/.no-fixture-reap" \
    OPERATOR_SKIP_LAUNCH=1 \
    bb "$PROJECT/swarmforge/scripts/operator_runtime.bb" "$PROJECT" --tick-once > /dev/null
}

RUNTIME_LOG="$PROJECT/.swarmforge/operator/runtime.log"

# ── bounded-deletes-01/02: a cap of 2 with 2 fresh entries sorting FIRST,
#    then 3 stale reapable entries sorting after them - the OLD fixed-window
#    bug would examine only a-fresh/b-fresh FOREVER and never reach the
#    reapable ones at all. ────────────────────────────────────────────────
mkdir -p "$SANDBOX_ROOT/sfvc-a-fresh" "$SANDBOX_ROOT/sfvc-b-fresh" \
  "$SANDBOX_ROOT/sfvc-c-stale" "$SANDBOX_ROOT/sfvc-d-stale" "$SANDBOX_ROOT/sfvc-e-stale"
old_mtime "$SANDBOX_ROOT/sfvc-c-stale"
old_mtime "$SANDBOX_ROOT/sfvc-d-stale"
old_mtime "$SANDBOX_ROOT/sfvc-e-stale"
# a-fresh/b-fresh keep their just-created mtime.

tick # tick 1: window = [a-fresh, b-fresh] (both fresh) - nothing reaped.
check "tick 1: neither fresh entry is removed" \
  '[[ -e "$SANDBOX_ROOT/sfvc-a-fresh" && -e "$SANDBOX_ROOT/sfvc-b-fresh" ]]'
check "tick 1: no stale entry removed yet either (window has not reached them)" \
  '[[ -e "$SANDBOX_ROOT/sfvc-c-stale" && -e "$SANDBOX_ROOT/sfvc-d-stale" && -e "$SANDBOX_ROOT/sfvc-e-stale" ]]'
check "tick 1: a periodic nothing-found line was logged (streak 1)" \
  'grep -q "sandbox-sweep scanned 2, nothing reaped (streak 1)" "$RUNTIME_LOG"'

tick # tick 2: cursor resumes after b-fresh -> window = [c-stale, d-stale].
check "tick 2: AT MOST the per-tick cap (2) of reapable entries are removed" \
  '[[ ! -e "$SANDBOX_ROOT/sfvc-c-stale" && ! -e "$SANDBOX_ROOT/sfvc-d-stale" ]]'
check "tick 2: the third reapable entry is NOT yet removed (beyond this tick's cap)" \
  '[[ -e "$SANDBOX_ROOT/sfvc-e-stale" ]]'
check "tick 2: a reap-summary line was logged naming the count" \
  'grep -q "sandbox-sweep reaped 2 of 2 scanned" "$RUNTIME_LOG"'

tick # tick 3: cursor resumes after d-stale -> window wraps and reaches e-stale.
check "BL-460 tmp-sweep-bounded-deletes-01/02: the remaining reapable entry is removed within a bounded number of ticks" \
  '[[ ! -e "$SANDBOX_ROOT/sfvc-e-stale" ]]'
check "fresh entries survive the whole sequence (never falsely reaped)" \
  '[[ -e "$SANDBOX_ROOT/sfvc-a-fresh" && -e "$SANDBOX_ROOT/sfvc-b-fresh" ]]'

rm -rf "$PROJECT" "$SANDBOX_ROOT"

# ── bounded-deletes-05: periodic (not per-tick) nothing-found logging ─────
PROJECT2="$(make_project_fixture)"
SANDBOX_ROOT2="$(mktemp -d)"
mkdir -p "$SANDBOX_ROOT2/sfvc-only-fresh"
RUNTIME_LOG2="$PROJECT2/.swarmforge/operator/runtime.log"

tick2() {
  SWARMFORGE_SANDBOX_SWEEP_ROOT="$SANDBOX_ROOT2" \
    SWARMFORGE_SANDBOX_STALE_HOURS=1 \
    SWARMFORGE_SANDBOX_SWEEP_MAX_PER_TICK=2 \
    SWARMFORGE_SANDBOX_SWEEP_NOTHING_LOG_PERIOD=3 \
    SWARMFORGE_FIXTURE_REAP_ROOT="$PROJECT2/.no-fixture-reap" \
    OPERATOR_SKIP_LAUNCH=1 \
    bb "$PROJECT2/swarmforge/scripts/operator_runtime.bb" "$PROJECT2" --tick-once > /dev/null
}

for _ in 1 2 3 4 5 6; do tick2; done

# streak 1 (always logged, first occurrence) then every 3rd (period 3): 1, 3, 6 -> 3 lines, not 6.
check "BL-460 tmp-sweep-bounded-deletes-05: a scanned-nothing line is logged periodically, not on every tick (6 ticks, period 3 -> 3 lines, not 6)" \
  '[[ "$(grep -c "sandbox-sweep scanned" "$RUNTIME_LOG2")" -eq 3 ]]'

rm -rf "$PROJECT2" "$SANDBOX_ROOT2"

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime sandbox-sweep bounded-progress: ALL CHECKS PASSED"
else
  echo "operator_runtime sandbox-sweep bounded-progress: FAILURES"; exit 1
fi
