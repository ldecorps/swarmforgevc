#!/usr/bin/env bash
# BL-1639: babysitterd_census_lib.sh — the root-scoped census shared by
# finish-shift's stop, its verify, and kill_all_swarm's BL-611 signal.
# Uses the SWARMFORGE_SURVIVOR_PS_FILE seam (stack_survivor_scan.sh's own
# convention, already used by test_finish_shift_lib.sh) so this test never
# depends on this machine's real process table, and
# SWARMFORGE_CENSUS_SIGNAL_RECORD_FILE so a fabricated (ps-snapshot-only)
# pid is never sent a real signal.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
source "$SRC/babysitterd_census_lib.sh"

PASS=0
FAIL=0
pass() { echo "PASS: $*"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $*" >&2; FAIL=$((FAIL + 1)); }

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
PS_FILE="$(mktemp)"
RECORD_FILE="$(mktemp)"

# ── 01: the tracked daemon's own line (script directly under
#    <root>/swarmforge/scripts/, root-arg token equal to root) is named ──
cat > "$PS_FILE" <<EOF
  100 $ROOT/swarmforge/scripts/babysitterd.sh $ROOT
EOF
result="$(SWARMFORGE_SURVIVOR_PS_FILE="$PS_FILE" babysitterd_census_pids "$ROOT")"
if [[ "$result" == "100" ]]; then
  pass "01: the tracked daemon's own ps line is named"
else
  fail "01: expected pid 100, got: [$result]"
fi

# ── 02: an operator-local copy (script directly under
#    <root>/.swarmforge/operator/, no root-arg token) is ALSO named ──────
cat > "$PS_FILE" <<EOF
  100 $ROOT/swarmforge/scripts/babysitterd.sh $ROOT
  200 $ROOT/.swarmforge/operator/babysitterd.sh
EOF
result="$(SWARMFORGE_SURVIVOR_PS_FILE="$PS_FILE" babysitterd_census_pids "$ROOT" | sort -n | tr '\n' ' ')"
if [[ "$result" == "100 200 " ]]; then
  pass "02: both the tracked daemon and the operator-local copy are named"
else
  fail "02: expected [100 200 ], got: [$result]"
fi

# ── 03: a babysitterd of ANOTHER root (unrelated path) is never named ───
cat > "$PS_FILE" <<EOF
  100 $ROOT/swarmforge/scripts/babysitterd.sh $ROOT
  300 /tmp/other/swarmforge/scripts/babysitterd.sh /tmp/other
EOF
result="$(SWARMFORGE_SURVIVOR_PS_FILE="$PS_FILE" babysitterd_census_pids "$ROOT" | sort -n | tr '\n' ' ')"
if [[ "$result" == "100 " ]]; then
  pass "03: a babysitterd of an unrelated root is never named"
else
  fail "03: expected [100 ], got: [$result]"
fi

# ── 04: a babysitterd of a root merely PREFIXED by this root (a sibling
#    worktree) is never named — exact dirname equality, never a prefix ──
cat > "$PS_FILE" <<EOF
  100 $ROOT/swarmforge/scripts/babysitterd.sh $ROOT
  400 $ROOT/.worktrees/coder/swarmforge/scripts/babysitterd.sh $ROOT/.worktrees/coder
EOF
result="$(SWARMFORGE_SURVIVOR_PS_FILE="$PS_FILE" babysitterd_census_pids "$ROOT" | sort -n | tr '\n' ' ')"
if [[ "$result" == "100 " ]]; then
  pass "04: a sibling worktree's babysitterd (prefix, not equal) is never named"
else
  fail "04: expected [100 ], got: [$result]"
fi

# ── 05: an empty snapshot names nothing ──────────────────────────────────
: > "$PS_FILE"
result="$(SWARMFORGE_SURVIVOR_PS_FILE="$PS_FILE" babysitterd_census_pids "$ROOT")"
if [[ -z "$result" ]]; then
  pass "05: an empty snapshot names nothing"
else
  fail "05: expected nothing, got: [$result]"
fi

# ── 06: babysitterd_census_signal records every named pid via the
#    injectable seam, sending no real signal ─────────────────────────────
cat > "$PS_FILE" <<EOF
  100 $ROOT/swarmforge/scripts/babysitterd.sh $ROOT
  200 $ROOT/.swarmforge/operator/babysitterd.sh
  300 /tmp/other/swarmforge/scripts/babysitterd.sh /tmp/other
EOF
: > "$RECORD_FILE"
(
  export SWARMFORGE_SURVIVOR_PS_FILE="$PS_FILE"
  export SWARMFORGE_CENSUS_SIGNAL_RECORD_FILE="$RECORD_FILE"
  babysitterd_census_signal "$ROOT"
)
recorded="$(sort -n "$RECORD_FILE" | tr '\n' ' ')"
if [[ "$recorded" == "100 200 " ]]; then
  pass "06: census_signal records exactly the two pids of this root"
else
  fail "06: expected [100 200 ], got: [$recorded]"
fi

# ── 07: census_signal really signals a real (test-owned) process when
#    the record-file seam is not set ─────────────────────────────────────
sleep 300 & REAL_PID=$!
cat > "$PS_FILE" <<EOF
  $REAL_PID $ROOT/swarmforge/scripts/babysitterd.sh $ROOT
EOF
(
  export SWARMFORGE_SURVIVOR_PS_FILE="$PS_FILE"
  babysitterd_census_signal "$ROOT"
)
if ! kill -0 "$REAL_PID" 2>/dev/null; then
  pass "07: census_signal really signals a real process when not recording"
else
  fail "07: expected pid $REAL_PID to be stopped"
  kill -9 "$REAL_PID" 2>/dev/null || true
fi

rm -f "$PS_FILE" "$RECORD_FILE"

echo ""
echo "BL-1639 babysitterd_census_lib results: PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]]
