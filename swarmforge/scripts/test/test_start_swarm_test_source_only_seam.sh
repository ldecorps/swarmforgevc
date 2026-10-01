#!/usr/bin/env bash
# BL-1839 hardener pass: the BL1839_TEST_SOURCE_ONLY=1 seam in
# start-swarm.sh is read by EVERY call site in
# specs/pipeline/steps/bl1839SwarmStampIq3HotfixesSteps.js with the var
# set to "1" - no caller anywhere ever sources start-swarm.sh with it
# unset. A mutant that makes the seam fire UNCONDITIONALLY (e.g. `if
# true; then` in place of the real `-n` check) therefore survives the
# entire acceptance feature untouched: 7/7 scenarios still pass, because
# every one of them already wants the early return. In production that
# exact mutant means start-swarm.sh NEVER launches anything, for any
# real invocation, ever - the single most severe regression this script
# can have, with zero test coverage to catch it before now.
#
# This cannot safely drive the real "unset" path to completion (the
# script after the seam starts real ancillary processes - the seam's own
# comment says "which no test may do"). Instead it proves the seam does
# NOT fire when unset, cheaply and side-effect-free: strip tmux/bb off
# PATH first, so the real script's OWN very next check (the "for tool in
# tmux bb" loop, lines 104-109) refuses with a distinct, recognizable
# error before anything with a side effect runs. A short-circuited source
# would never reach that loop at all and would exit 0 instead.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
START_SWARM_SH="$REPO_ROOT/start-swarm.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

make_root() { local d; d="$(mktemp -d)"; register_tmp_dir "$d"; printf '%s' "$d"; }

# ── 01: BL1839_TEST_SOURCE_ONLY=1 returns before the tool-existence check ──
HOME1="$(make_root)"
TARGET1="$(make_root)"
echo "export OPENAI_API_KEY=sk-real-key" > "$HOME1/.zshenv"
OUT1="$(bash -c "
  export HOME='$HOME1' PATH='/nonexistent-bin-dir' BL1839_TEST_SOURCE_ONLY=1
  source '$START_SWARM_SH' '$TARGET1'
  echo SOURCED_OK
" 2>&1)"
RC1=$?
[[ "$RC1" -eq 0 ]] || fail "01: BL1839_TEST_SOURCE_ONLY=1 should source cleanly (exit 0), got $RC1: $OUT1"
[[ "$OUT1" == *"SOURCED_OK"* ]] || fail "01: expected sourcing to return control to the caller: $OUT1"
[[ "$OUT1" != *"required tool"* ]] || fail "01: the tool-existence check must never run under the test-only seam: $OUT1"
pass "01: BL1839_TEST_SOURCE_ONLY=1 returns before the tool-existence check (and everything after it)"

# ── 02: unset (the REAL launch path) reaches the tool-existence check ─────
# tmux/bb are deliberately absent from PATH, so a script that correctly
# proceeds past the seam fails here with its OWN named error - never a
# generic/unrelated failure, and never a successful real launch (which
# this test must not trigger).
HOME2="$(make_root)"
TARGET2="$(make_root)"
echo "export OPENAI_API_KEY=sk-real-key" > "$HOME2/.zshenv"
set +e
OUT2="$(bash -c "
  export HOME='$HOME2' PATH='/nonexistent-bin-dir'
  unset BL1839_TEST_SOURCE_ONLY
  source '$START_SWARM_SH' '$TARGET2'
" 2>&1)"
RC2=$?
set -e
[[ "$RC2" -ne 0 ]] || fail "02: expected a nonzero exit once BL1839_TEST_SOURCE_ONLY is unset and tmux/bb are missing, got 0: $OUT2"
[[ "$OUT2" == *"required tool 'tmux' not found"* ]] || fail "02: expected the script's own named tool-missing error (proof it ran PAST the seam), got: $OUT2"
pass "02: with BL1839_TEST_SOURCE_ONLY unset, the script runs past the seam into its own tool-existence check (proven by its own named failure, not a short-circuit)"

echo "ALL PASS"
