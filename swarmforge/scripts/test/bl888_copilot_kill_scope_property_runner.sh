#!/usr/bin/env bash
# BL-888 property encoding (architect rematch D1):
#   Invariant: a teardown kill step signals only processes belonging to the
#   root being torn down — a process of any other root, or of the operator's
#   own tooling, is never signaled.
#
# Quantifies over argv/root pairs via the PRODUCTION helpers
# (copilot_argv_matches_root / copilot_pids_for_root) from
# kill_pipeline_swarm.sh — not a reimplementation. Non-vacuity: a matcher
# that drops the ROOT anchor (or only requires copilot+SwarmForge) fails
# the foreign-root cases below.
#
# Usage: bash bl888_copilot_kill_scope_property_runner.sh
# Env: PROPERTY_RUNS (default 200)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KILL_SH="$SCRIPT_DIR/../kill_pipeline_swarm.sh"
RUNS="${PROPERTY_RUNS:-200}"

fail() { echo "FAIL: $*" >&2; FAILURES=$((FAILURES + 1)); }
FAILURES=0

eval "$(sed -n '/^copilot_argv_matches_root()/,/^}/p; /^copilot_pids_for_root()/,/^}/p' "$KILL_SH")"

# Broken oracle: matches any copilot+SwarmForge argv (no ROOT) — the
# pre-BL-888 unscoped pkill shape. Used only for non-vacuity.
broken_matches() {
  local rest="$1"
  [[ "$rest" == *copilot* && "$rest" == *SwarmForge* ]]
}

# Seeded LCG (same shape as babashka property runners in this tree).
# Must not run in a subshell — SEED is mutated in-place; result in GEN_INT.
SEED=71
gen_int() {
  local n="$1"
  SEED=$(( (SEED * 1103515245 + 12345) % 2147483648 ))
  GEN_INT=$(( (SEED / 65536) % n ))
}

ROOT_A="/tmp/bl888-prop-root-a"
ROOT_B="/tmp/bl888-prop-root-b"
ROLE_SUFFIXES=(coder cleaner QA architect)

expect_match() {
  local label="$1" argv="$2"
  if ! copilot_argv_matches_root "$argv" "$ROOT_A"; then
    fail "seed=$SEED kind=$label must match: $argv"
  fi
}

expect_reject() {
  local label="$1" argv="$2"
  if copilot_argv_matches_root "$argv" "$ROOT_A"; then
    fail "seed=$SEED kind=$label must NOT match: $argv"
  fi
}

assert_pid_scan() {
  local label="$1" pid="$2" argv="$3" want_empty="$4"
  local psf out
  psf="$(mktemp)"
  printf ' %s %s\n' "$pid" "$argv" > "$psf"
  out="$(SWARMFORGE_COPILOT_PS_FILE="$psf" copilot_pids_for_root "$ROOT_A" || true)"
  rm -f "$psf"
  if [[ "$want_empty" -eq 1 ]]; then
    [[ -z "$out" ]] || fail "seed=$SEED kind=$label pid leak: $out"
  else
    echo "$out" | grep -qx "$pid" || fail "seed=$SEED kind=$label pid miss: got=$out"
  fi
}

case_same_full() {
  local role="$1" i="$2"
  local argv="copilot -C ${ROOT_A}/.worktrees/${role} --name SwarmForge ${role}"
  expect_match same-full "$argv"
  assert_pid_scan same-full "9000$i" "$argv" 0
}

case_foreign() {
  local role="$1" i="$2"
  local argv="copilot -C ${ROOT_B}/.worktrees/${role} --name SwarmForge ${role}"
  expect_reject foreign "$argv"
  assert_pid_scan foreign "9100$i" "$argv" 1
}

case_no_marker() {
  local role="$1"
  expect_reject no-marker "copilot -C ${ROOT_A}/.worktrees/${role}"
}

case_no_copilot() {
  local role="$1"
  expect_reject no-copilot "claude -C ${ROOT_A}/.worktrees/${role} --name SwarmForge ${role}"
}

case_reorder() {
  local role="$1"
  expect_match reorder "--name SwarmForge ${role} copilot -C ${ROOT_A}/x"
}

case_decoy() {
  local role="$1"
  expect_reject decoy "copilot -C ${ROOT_B}/y --name SwarmForgeX ${role}"
}

KIND_FNS=(case_same_full case_foreign case_no_marker case_no_copilot case_reorder case_decoy)

# --- Non-vacuity (must run first; proves generator reach) -----------------
foreign_argv="copilot -C ${ROOT_B}/.worktrees/coder --name SwarmForge coder"
if copilot_argv_matches_root "$foreign_argv" "$ROOT_A"; then
  fail "non-vacuity setup: production matcher must reject foreign root"
fi
if ! broken_matches "$foreign_argv"; then
  fail "non-vacuity setup: broken oracle must accept foreign SwarmForge copilot"
fi
# If we only had the broken oracle, foreign would wrongly "match" — property
# would be vacuous without ROOT discrimination.
if broken_matches "$foreign_argv" && ! copilot_argv_matches_root "$foreign_argv" "$ROOT_A"; then
  : # expected discrimination — property has bite
else
  fail "non-vacuity: production vs broken oracle must disagree on foreign root"
fi

# --- Property loop --------------------------------------------------------
i=0
while (( i < RUNS )); do
  gen_int ${#KIND_FNS[@]}
  kind="$GEN_INT"
  gen_int ${#ROLE_SUFFIXES[@]}
  role="${ROLE_SUFFIXES[$GEN_INT]}"
  "${KIND_FNS[$kind]}" "$role" "$i"
  i=$((i + 1))
done

# Structural: production kill script must not contain unscoped pkill.
if grep -qE "pkill -f ['\"]copilot\.\*SwarmForge" "$KILL_SH"; then
  fail "structural: unscoped pkill restored in kill_pipeline_swarm.sh"
fi
grep -q 'copilot_argv_matches_root' "$KILL_SH" || fail "structural: matcher helper missing"

if (( FAILURES > 0 )); then
  echo "bl888_copilot_kill_scope_property: $FAILURES FAILURE(S)" >&2
  exit 1
fi
echo "bl888_copilot_kill_scope_property: ALL PROPERTIES HOLD ($RUNS runs)"
