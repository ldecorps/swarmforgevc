#!/usr/bin/env bash
# BL-877 (invariant 1, acceptance scenario 05): "Liveness is never silently
# assumed absent... a host where no liveness facility works surfaces that,
# rather than returning an empty set that reads as 'no process is live'."
# BL-1570: "neither facility reachable" is CONSTRUCTED on every host, not
# assumed from the host /proc happens to lack. Pointing SWARMFORGE_LSOF_BIN
# at a nonexistent path removes lsof; pointing SWARMFORGE_PROC_DIR (the seam
# BL-877 shipped in proc_fd_scan_lib.bb) at a nonexistent path removes
# /proc the same way on Linux as it is already absent on macOS - without
# touching real system binaries or PATH globally.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/operator_runtime_sandbox.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

# BL-801: guard the empty-array case under stock macOS bash 3.2's `set -u`.
TMP_DIRS=()
cleanup() { rm -rf ${TMP_DIRS[@]+"${TMP_DIRS[@]}"}; }
trap cleanup EXIT

make_project_fixture() {
  # NOTE: called as `x="$(make_project_fixture)"` at every call site, which
  # runs this function in a subshell - appending to TMP_DIRS in here would
  # only mutate the subshell's copy and silently fail to register the dir.
  # Callers must append the returned path to TMP_DIRS themselves.
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.swarmforge/operator" "$d/swarmforge/scripts" "$d/swarmforge/roles"
  copy_operator_runtime_sandbox "$SRC" "$d/swarmforge/scripts"
  printf '%s' "$d"
}

source "$SCRIPT_DIR/../portable_time_lib.sh"
old_mtime() { portable_touch_relative 2 hours "$1"; }

run_tick() {
  # lsof_override="" runs the REAL facility (control); a nonexistent path
  # simulates total unavailability. proc_dir_override, when non-empty,
  # points SWARMFORGE_PROC_DIR at a path that does not exist, constructing
  # "no /proc" identically on every host; empty (the control tick) leaves
  # the real /proc in place.
  local project="$1" sandbox_root="$2" lsof_override="$3" proc_dir_override="${4:-}"
  # BL-801: a plain `VAR=val` word built from expansion is not recognized
  # as an assignment prefix by bash - only `env` treats it as plain data,
  # so the conditional var rides through `env`, not the prefix-assignment
  # list.
  local extra_env=()
  if [[ -n "$proc_dir_override" ]]; then
    extra_env=(SWARMFORGE_PROC_DIR="$proc_dir_override")
  fi
  env \
    SWARMFORGE_SANDBOX_SWEEP_ROOT="$sandbox_root" \
    SWARMFORGE_SANDBOX_STALE_HOURS=1 \
    SWARMFORGE_FIXTURE_REAP_ROOT="$project/.no-fixture-reap" SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS="" \
    SWARMFORGE_LSOF_BIN="$lsof_override" \
    OPERATOR_SKIP_LAUNCH=1 \
    ${extra_env[@]+"${extra_env[@]}"} \
    bb "$project/swarmforge/scripts/operator_runtime.bb" "$project" --tick-once > /dev/null
}

# ── control: the real facility (lsof) determines liveness normally ────────
CONTROL_PROJECT="$(make_project_fixture)"
TMP_DIRS+=("$CONTROL_PROJECT")
CONTROL_ROOT="$(mktemp -d)"
TMP_DIRS+=("$CONTROL_ROOT")
CONTROL_STALE="$CONTROL_ROOT/sfvc-stale-idle"
mkdir -p "$CONTROL_STALE"
old_mtime "$CONTROL_STALE"
run_tick "$CONTROL_PROJECT" "$CONTROL_ROOT" ""
check "control: a stale sandbox with nothing rooted in it is reaped when liveness IS determined" \
  '[[ ! -e "$CONTROL_STALE" ]]'

# ── undetermined: neither /proc nor lsof are reachable, constructed via the
# SWARMFORGE_PROC_DIR and SWARMFORGE_LSOF_BIN seams so the case is identical
# on every host ──
PROJECT="$(make_project_fixture)"
TMP_DIRS+=("$PROJECT")
SANDBOX_ROOT="$(mktemp -d)"
TMP_DIRS+=("$SANDBOX_ROOT")
STALE="$SANDBOX_ROOT/sfvc-stale-idle"
mkdir -p "$STALE"
old_mtime "$STALE"
RUNTIME_LOG="$PROJECT/.swarmforge/operator/runtime.log"

run_tick "$PROJECT" "$SANDBOX_ROOT" "/nonexistent/path/to/lsof-bl877-test" "$SANDBOX_ROOT/.no-proc"

check "undetermined: a stale sandbox with nothing rooted in it is KEPT when liveness is undetermined (fail-safe)" \
  '[[ -e "$STALE" ]]'
check "undetermined: the sweep records that liveness could not be determined" \
  'grep -q "liveness could not be determined this pass" "$RUNTIME_LOG"'

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime sandbox-sweep liveness-undetermined: ALL CHECKS PASSED"
else
  echo "operator_runtime sandbox-sweep liveness-undetermined: FAILURES"; exit 1
fi
