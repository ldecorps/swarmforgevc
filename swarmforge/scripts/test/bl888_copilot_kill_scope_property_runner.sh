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
  gen_int 6
  kind="$GEN_INT"
  gen_int ${#ROLE_SUFFIXES[@]}
  role="${ROLE_SUFFIXES[$GEN_INT]}"
  case "$kind" in
    0)
      # same-root full launch_body shape → MUST match
      argv="copilot -C ${ROOT_A}/.worktrees/${role} --name SwarmForge ${role}"
      if ! copilot_argv_matches_root "$argv" "$ROOT_A"; then
        fail "seed=$SEED kind=same-full must match: $argv"
      fi
      # pid scan must yield the fixture pid
      PSF="$(mktemp)"
      printf ' %s %s\n' "9000$i" "$argv" > "$PSF"
      out="$(SWARMFORGE_COPILOT_PS_FILE="$PSF" copilot_pids_for_root "$ROOT_A" || true)"
      rm -f "$PSF"
      echo "$out" | grep -qx "9000$i" || fail "seed=$SEED kind=same-full pid miss: got=$out"
      ;;
    1)
      # foreign-root full shape → MUST NOT match teardown root
      argv="copilot -C ${ROOT_B}/.worktrees/${role} --name SwarmForge ${role}"
      if copilot_argv_matches_root "$argv" "$ROOT_A"; then
        fail "seed=$SEED kind=foreign must NOT match: $argv"
      fi
      PSF="$(mktemp)"
      printf ' %s %s\n' "9100$i" "$argv" > "$PSF"
      out="$(SWARMFORGE_COPILOT_PS_FILE="$PSF" copilot_pids_for_root "$ROOT_A" || true)"
      rm -f "$PSF"
      [[ -z "$out" ]] || fail "seed=$SEED kind=foreign pid leak: $out"
      ;;
    2)
      # same root, missing SwarmForge marker → MUST NOT match
      argv="copilot -C ${ROOT_A}/.worktrees/${role}"
      if copilot_argv_matches_root "$argv" "$ROOT_A"; then
        fail "seed=$SEED kind=no-marker must NOT match: $argv"
      fi
      ;;
    3)
      # same root, missing copilot token → MUST NOT match (operator tooling)
      argv="claude -C ${ROOT_A}/.worktrees/${role} --name SwarmForge ${role}"
      if copilot_argv_matches_root "$argv" "$ROOT_A"; then
        fail "seed=$SEED kind=no-copilot must NOT match: $argv"
      fi
      ;;
    4)
      # SwarmForge after path still matches (order must not be assumed)
      argv="--name SwarmForge ${role} copilot -C ${ROOT_A}/x"
      if ! copilot_argv_matches_root "$argv" "$ROOT_A"; then
        fail "seed=$SEED kind=reorder must match: $argv"
      fi
      ;;
    5)
      # decoy marker SwarmForgeX + foreign path — never signal for ROOT_A
      argv="copilot -C ${ROOT_B}/y --name SwarmForgeX ${role}"
      if copilot_argv_matches_root "$argv" "$ROOT_A"; then
        fail "seed=$SEED kind=decoy must NOT match: $argv"
      fi
      ;;
  esac
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
