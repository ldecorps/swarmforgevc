#!/usr/bin/env bash
# BL-937 invariants 1 & 3 (coder-authored, first pass - BL-654): this file
# is the executable proof that the portable `mapfile -t` replacement idiom
# BL-937 applies at 12 sites across 6 files -
#
#   ARR=()
#   line=""
#   while IFS= read -r line || [[ -n "$line" ]]; do
#     ARR+=("$line")
#   done < <(cmd)
#
# - is behaviourally exact for every edge case invariant 1 names by name:
# zero elements from empty output, a final line captured even with no
# trailing newline, and lines containing spaces/tabs/backslashes preserved
# verbatim. `mapfile` itself is bash 4.0+ only and genuinely absent from
# this host (the whole reason this ticket exists) - there is no live
# mapfile to diff the idiom against directly, so this instead verifies it
# against mapfile's own well-documented contract (bash manual: read lines
# delimited by newline or EOF; -t strips the trailing delimiter; a final
# undelimited line is still captured as the last element; no word-splitting
# or backslash interpretation absent -d/-n options) - the same
# specification the port at every real call site implicitly relies on.
#
# Invariant 3 (safe under `set -u`, BL-801's own failure mode): case 5
# below expands a genuinely EMPTY result of this exact idiom via the
# `"${ARR[@]+"${ARR[@]}"}"` guard and confirms no unbound-variable abort.

set -euo pipefail

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# Runs the idiom under test against raw bytes (never a here-string, which
# always appends its own trailing newline and would silently defeat the
# no-trailing-newline case) and leaves the result in the globals below -
# bash 3.2 has no local array return without name-indirection, so a
# side-effect pair is the plain, portable choice here too.
CAPTURED_COUNT=0
CAPTURED_ARR=()
run_capture() {
  local -a ARR=()
  local line=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    ARR+=("$line")
  done < <(printf '%s' "$1")
  CAPTURED_COUNT=${#ARR[@]}
  CAPTURED_ARR=("${ARR[@]+"${ARR[@]}"}")
}

assert_elements() {
  local desc="$1"
  shift
  local -a expected=("$@")
  [[ "$CAPTURED_COUNT" -eq "${#expected[@]}" ]] \
    || fail "$desc: expected ${#expected[@]} element(s), got $CAPTURED_COUNT"
  local i
  for ((i = 0; i < ${#expected[@]}; i++)); do
    [[ "${CAPTURED_ARR[$i]}" == "${expected[$i]}" ]] \
      || fail "$desc: element $i expected '${expected[$i]}', got '${CAPTURED_ARR[$i]}'"
  done
  pass "$desc"
}

# ── 01: empty output yields zero elements ───────────────────────────────
run_capture ""
assert_elements "01: empty output -> zero elements"

# ── 02: a normal trailing-newline-terminated multi-line stream ─────────
run_capture $'line1\nline2\nline3\n'
assert_elements "02: trailing-newline stream -> exact element list" "line1" "line2" "line3"

# ── 03: the FINAL line has NO trailing newline - still captured ────────
# This is invariant 1's own explicit callout ("the empty-output case is
# the one that most often is not [handled]" - the sibling failure mode
# being the final-line case, which a bare `while read` loop WITHOUT the
# `|| [[ -n "$line" ]]` guard silently drops).
run_capture $'line1\nline2'
assert_elements "03: no trailing newline on the final line -> still captured" "line1" "line2"

# ── 04: a single line with no newline at all ────────────────────────────
run_capture "onlyline"
assert_elements "04: single line, no newline at all -> one element" "onlyline"

# ── 05: spaces, tabs and a literal backslash preserved verbatim ────────
# IFS= prevents leading/trailing whitespace stripping and internal
# word-splitting; -r prevents backslash-escape interpretation. Both are
# required - either one alone still corrupts this case.
run_capture $'  a b\tc\\d  \n'
assert_elements "05: spaces/tabs/backslash preserved verbatim" '  a b'$'\t''c\d  '

# ── 06: BL-801 - a genuinely empty result expands safely under set -u ──
run_capture ""
# shellcheck disable=SC2128
unbound_would_abort=0
for _ in "${CAPTURED_ARR[@]+"${CAPTURED_ARR[@]}"}"; do
  unbound_would_abort=1
done
[[ "$unbound_would_abort" -eq 0 ]] \
  || fail "06: the empty-array guard iterated when it should have iterated zero times"
pass "06: an empty result of the portable idiom expands safely under set -u (BL-801 guard)"

echo "ALL PASS: test_bl937_portable_mapfile_replacement.sh"
