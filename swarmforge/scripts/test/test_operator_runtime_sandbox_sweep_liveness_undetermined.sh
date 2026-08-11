#!/usr/bin/env bash
# BL-877 (invariant 1, acceptance scenario 05): "Liveness is never silently
# assumed absent... a host where no liveness facility works surfaces that,
# rather than returning an empty set that reads as 'no process is live'."
# On this host /proc is already absent (macOS). Pointing
# SWARMFORGE_LSOF_BIN at a nonexistent path removes the ONLY other facility
# proc-fd-scan-lib/live-pid-paths! can use, reproducing "neither facility
# reachable" without touching real system binaries or PATH globally.
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

run_tick() {
  # lsof_override="" runs the REAL facility (control); a nonexistent path
  # simulates total unavailability (macOS already has no /proc).
  local project="$1" sandbox_root="$2" lsof_override="$3"
  SWARMFORGE_SANDBOX_SWEEP_ROOT="$sandbox_root" \
    SWARMFORGE_SANDBOX_STALE_HOURS=1 \
    SWARMFORGE_FIXTURE_REAP_ROOT="$project/.no-fixture-reap" SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS="" \
    SWARMFORGE_LSOF_BIN="$lsof_override" \
    OPERATOR_SKIP_LAUNCH=1 \
    bb "$project/swarmforge/scripts/operator_runtime.bb" "$project" --tick-once > /dev/null
}

# ── control: the real facility (lsof) determines liveness normally ────────
CONTROL_PROJECT="$(make_project_fixture)"
CONTROL_ROOT="$(mktemp -d)"
CONTROL_STALE="$CONTROL_ROOT/sfvc-stale-idle"
mkdir -p "$CONTROL_STALE"
old_mtime "$CONTROL_STALE"
run_tick "$CONTROL_PROJECT" "$CONTROL_ROOT" ""
check "control: a stale sandbox with nothing rooted in it is reaped when liveness IS determined" \
  '[[ ! -e "$CONTROL_STALE" ]]'

# ── undetermined: neither /proc (already absent) nor lsof (forced absent) ──
PROJECT="$(make_project_fixture)"
SANDBOX_ROOT="$(mktemp -d)"
STALE="$SANDBOX_ROOT/sfvc-stale-idle"
mkdir -p "$STALE"
old_mtime "$STALE"
RUNTIME_LOG="$PROJECT/.swarmforge/operator/runtime.log"

run_tick "$PROJECT" "$SANDBOX_ROOT" "/nonexistent/path/to/lsof-bl877-test"

check "undetermined: a stale sandbox with nothing rooted in it is KEPT when liveness is undetermined (fail-safe)" \
  '[[ -e "$STALE" ]]'
check "undetermined: the sweep records that liveness could not be determined" \
  'grep -q "liveness could not be determined this pass" "$RUNTIME_LOG"'

rm -rf "$CONTROL_PROJECT" "$CONTROL_ROOT" "$PROJECT" "$SANDBOX_ROOT"

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime sandbox-sweep liveness-undetermined: ALL CHECKS PASSED"
else
  echo "operator_runtime sandbox-sweep liveness-undetermined: FAILURES"; exit 1
fi
