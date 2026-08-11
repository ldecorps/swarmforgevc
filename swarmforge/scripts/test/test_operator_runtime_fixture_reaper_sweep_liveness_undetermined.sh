#!/usr/bin/env bash
# BL-877 (invariant 1, fixture-reaper side): the sandbox-sweep sibling of
# this test (test_operator_runtime_sandbox_sweep_liveness_undetermined.sh)
# covers operator_runtime.bb's own "liveness could not be determined" log
# line and fail-safe-keep default. fixture_reaper_sweep_lib.bb's
# real-adapters logs a DIFFERENT message ("...killing nothing this pass")
# and takes the opposite safe direction (tree still reaped, kill list empty)
# - neither was covered anywhere before this test. On this host /proc is
# already absent (macOS). Pointing SWARMFORGE_LSOF_BIN at a nonexistent path
# removes the ONLY other facility proc-fd-scan-lib/live-pid-paths! can use,
# reproducing "neither facility reachable" without touching real system
# binaries or PATH globally.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/operator_runtime_sandbox.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_project_fixture() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.swarmforge/operator" "$d/swarmforge/scripts" "$d/swarmforge/roles"
  copy_operator_runtime_sandbox "$SRC" "$d/swarmforge/scripts"
  printf '%s' "$d"
}

source "$SCRIPT_DIR/../portable_time_lib.sh"
old_mtime() { portable_touch_relative 2 hours "$1"; }

LIVE_PIDS=()
cleanup() {
  for p in "${LIVE_PIDS[@]:-}"; do
    [[ -n "$p" ]] && kill -TERM "$p" 2>/dev/null || true
  done
}
trap cleanup EXIT

run_tick() {
  local project="$1" reap_root="$2" lsof_override="$3"
  SWARMFORGE_FIXTURE_REAP_ROOT="$reap_root" SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS="" \
    SWARMFORGE_FIXTURE_REAP_STALE_HOURS=1 \
    SWARMFORGE_SANDBOX_SWEEP_ROOT="$project/.no-sandbox-sweep" \
    SWARMFORGE_LSOF_BIN="$lsof_override" \
    OPERATOR_SKIP_LAUNCH=1 \
    bb "$project/swarmforge/scripts/operator_runtime.bb" "$project" --tick-once > /dev/null
}

# ── undetermined: neither /proc (already absent) nor lsof (forced absent) ──
PROJECT="$(make_project_fixture)"
REAP_ROOT="$(mktemp -d)"
STALE_ORPHAN="$REAP_ROOT/aps-stale-orphan"
mkdir -p "$STALE_ORPHAN"

(cd "$STALE_ORPHAN" && exec sleep 30) &
ORPHAN_PID=$!
LIVE_PIDS+=("$ORPHAN_PID")

for _ in 1 2 3 4 5; do
  [[ -e "/proc/$ORPHAN_PID/cwd" ]] || sleep 0.1
done

old_mtime "$STALE_ORPHAN"

RUNTIME_LOG="$PROJECT/.swarmforge/operator/runtime.log"

run_tick "$PROJECT" "$REAP_ROOT" "/nonexistent/path/to/lsof-bl877-reaper-test"

check "undetermined: the process rooted in the reaped root survives (liveness could not be determined, so nothing is killed)" \
  'kill -0 "$ORPHAN_PID" 2>/dev/null'
check "undetermined: the stale root itself is still removed (the reaper's own safe direction is independent of liveness)" \
  '[[ ! -e "$STALE_ORPHAN" ]]'
check "undetermined: the reaper records its own distinct liveness-undetermined message" \
  'grep -q "liveness could not be determined this pass (no /proc, no lsof) - killing nothing this pass" "$RUNTIME_LOG"'

kill -TERM "$ORPHAN_PID" 2>/dev/null || true
LIVE_PIDS=()
rm -rf "$PROJECT" "$REAP_ROOT"

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime fixture-reaper-sweep liveness-undetermined: ALL CHECKS PASSED"
else
  echo "operator_runtime fixture-reaper-sweep liveness-undetermined: FAILURES"; exit 1
fi
