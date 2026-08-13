#!/usr/bin/env bash
# BL-730: pipeline_survivor_scan_lib.sh - kill_pipeline_swarm.sh's post-
# teardown "remaining survivors" check, scoped to $ROOT.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"
# shellcheck disable=SC1091
source "$SCRIPTS/pipeline_survivor_scan_lib.sh"

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_ps_file() {
  local d f
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  f="$d/ps.txt"
  cat > "$f"
  printf '%s' "$f"
}

# ── BL-730 pipeline-teardown-survivor-scope-01 / 02 ────────────────────────

PS1="$(make_ps_file <<'EOF'
  1 init
1234 bb /repos/alpha/swarmforge/scripts/handoffd.bb /repos/alpha
5678 bb /repos/beta/swarmforge/scripts/handoffd.bb /repos/beta
EOF
)"
SWARMFORGE_PIPELINE_SURVIVOR_PS_FILE="$PS1" pipeline_survivor_scan "/repos/alpha" && found1=1 || found1=0
check "01: a same-root handoffd.bb IS named a survivor" '[[ "$found1" -eq 1 ]]'
check "01: a same-root handoffd.bb line is in the report" '[[ "$pipeline_survivor_lines" == *"1234"* ]]'
check "01: a different-root handoffd.bb is NOT named a survivor" '[[ "$pipeline_survivor_lines" != *"5678"* ]]'

PS2="$(make_ps_file <<'EOF'
  1 init
2222 copilot --project /repos/alpha SwarmForge
3333 copilot --project /repos/beta SwarmForge
EOF
)"
SWARMFORGE_PIPELINE_SURVIVOR_PS_FILE="$PS2" pipeline_survivor_scan "/repos/alpha" && found2=1 || found2=0
check "01: a same-root copilot SwarmForge process IS named a survivor" '[[ "$found2" -eq 1 ]]'
check "01: a same-root copilot line is in the report" '[[ "$pipeline_survivor_lines" == *"2222"* ]]'
check "01: a different-root copilot process is NOT named a survivor" '[[ "$pipeline_survivor_lines" != *"3333"* ]]'

# ── BL-730 pipeline-teardown-survivor-scope-02: exit status follows verdict ─

PS3="$(make_ps_file <<'EOF'
  1 init
9999 bb /repos/beta/swarmforge/scripts/handoffd.bb /repos/beta
EOF
)"
if SWARMFORGE_PIPELINE_SURVIVOR_PS_FILE="$PS3" pipeline_survivor_scan "/repos/alpha"; then
  check "02: only-a-different-root survivor -> zero exit" 'false'
else
  check "02: only-a-different-root survivor -> zero exit" 'true'
fi

PS4="$(make_ps_file <<'EOF'
  1 init
8888 bb /repos/alpha/swarmforge/scripts/handoffd.bb /repos/alpha
EOF
)"
if SWARMFORGE_PIPELINE_SURVIVOR_PS_FILE="$PS4" pipeline_survivor_scan "/repos/alpha"; then
  check "02: own-root survivor -> non-zero exit" 'true'
else
  check "02: own-root survivor -> non-zero exit" 'false'
fi

# ── BL-730 pipeline-teardown-survivor-scope-03: never reports itself ───────
# The scanning process's own pid, with argv genuinely mentioning
# "handoffd.bb" and the root, must still never appear in its own report.
PS5="$(mktemp -d)"
register_tmp_dir "$PS5"
PS5="$PS5/ps.txt"
printf '  1 init\n%s bash %s handoffd.bb /repos/alpha\n' "$$" "$SCRIPT_DIR/test_pipeline_survivor_scan.sh" > "$PS5"
SWARMFORGE_PIPELINE_SURVIVOR_PS_FILE="$PS5" pipeline_survivor_scan "/repos/alpha" && found5=1 || found5=0
check "03: no real survivor + self-mentioning argv -> zero exit" '[[ "$found5" -eq 0 ]]'
check "03: the report is empty" '[[ -z "$pipeline_survivor_lines" ]]'

# ── property-style coverage (BL-654 coder-authored, invariants 1 and 2) ────
# Invariant 1: "The teardown's survivor verdict is a function of processes
# belonging to the root being torn down: no process of any other root can
# change it." Invariant 2: "The scanning process's own command line can
# never appear in its own survivor report." No fast-check-equivalent harness
# exists for bash in this repo (BL-654's *.property.test.js convention is
# TypeScript/Vitest-specific tooling) - encoded here instead as many
# generated (root, other-root, pid) combinations in the normal shell-test
# suite, the bash-side equivalent of the same discipline.
ROOTS=(/repos/alpha /repos/beta /repos/gamma /home/carillon/swarmforgevc "/repos/with spaces")
PROP_FAIL=0
for i in $(seq 1 40); do
  root="${ROOTS[$((i % ${#ROOTS[@]}))]}"
  other="${ROOTS[$(((i + 1) % ${#ROOTS[@]}))]}"
  pid=$((10000 + i))
  otherpid=$((20000 + i))
  psf="$(mktemp -d)/ps.txt"
  mkdir -p "$(dirname "$psf")"
  register_tmp_dir "$(dirname "$psf")"
  {
    printf '  1 init\n'
    printf '%s bb %s/swarmforge/scripts/handoffd.bb %s\n' "$pid" "$root" "$root"
    printf '%s bb %s/swarmforge/scripts/handoffd.bb %s\n' "$otherpid" "$other" "$other"
  } > "$psf"
  SWARMFORGE_PIPELINE_SURVIVOR_PS_FILE="$psf" pipeline_survivor_scan "$root"
  if [[ "$pipeline_survivor_lines" != *"$pid "* ]]; then
    note "FAIL - property: root=$root did not name its own pid=$pid; lines=$pipeline_survivor_lines"
    PROP_FAIL=1
  fi
  if [[ "$root" != "$other" && "$pipeline_survivor_lines" == *"$otherpid "* ]]; then
    note "FAIL - property: root=$root wrongly named other-root pid=$otherpid (other=$other); lines=$pipeline_survivor_lines"
    PROP_FAIL=1
  fi
done
check "property: over 40 generated (root, other-root) pairs, only the matching root's pid is ever named" '[[ "$PROP_FAIL" -eq 0 ]]'

# Non-vacuity companion: an unscoped scan (the ORIGINAL defect - grep with
# no root anchor at all) would fail the property above by construction -
# demonstrate it, then confirm the real function does not share this flaw.
PS_NAIVE="$(make_ps_file <<'EOF'
  1 init
7777 bb /repos/beta/swarmforge/scripts/handoffd.bb /repos/beta
EOF
)"
naive_matches="$(grep -c 'handoffd\.bb' "$PS_NAIVE" || true)"
check "non-vacuity: the naive unscoped grep DOES match a different root's process" '[[ "$naive_matches" -eq 1 ]]'
SWARMFORGE_PIPELINE_SURVIVOR_PS_FILE="$PS_NAIVE" pipeline_survivor_scan "/repos/alpha" && real_found=1 || real_found=0
check "non-vacuity: the real root-scoped function does NOT match that different root's process" '[[ "$real_found" -eq 0 ]]'

if [[ "$fail" -eq 0 ]]; then
  echo "pipeline_survivor_scan: ALL CHECKS PASSED"
else
  echo "pipeline_survivor_scan: FAILURES"
  exit 1
fi
