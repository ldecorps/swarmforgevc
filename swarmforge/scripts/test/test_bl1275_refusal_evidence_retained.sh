#!/usr/bin/env bash
# BL-1275: the property-suite guard must leave the suite output it refused a
# commit on somewhere durable, and say where.
#
# Before this ticket the run was captured into a `mktemp` file, echoed to
# stderr and `rm -f`d, so the only surviving copy of a refusal's evidence was
# terminal scrollback. Twice that decided an investigation: a retained 53KB
# properties.log split one vague report into four distinct mechanisms on
# 2026-08-22, and a swept log left bl955 unadjudicated on 2026-08-29. Four
# different files refused five commits in a single shift, so a fixed-name log
# would have kept only the last - precisely the one that was not the question.
#
# Every case below drives the REAL guard through its documented positional
# suite-command seam (no env bypass), in a scratch repo, exactly as the
# acceptance handler and the qa_e2e_procedure do.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GUARD="$REPO_ROOT/swarmforge/scripts/check_property_suite_drift.sh"
RETAIN_REL=".swarmforge/property-guard-refusals"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

FIXTURE_PREFIX="sfvc-bl1275-guard"
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1275_SUITE_BOUND_SECONDS:-600}" "$@"
trap 'rm -rf "$WORK"' EXIT

# A scratch repo with one staged property-suite trigger path, so the guard
# reaches its suite run rather than short-circuiting on "skip-paths".
mk_repo() {
  local root="$1"
  mkdir -p "$root/extension/src"
  git -C "$root" init -q
  git -C "$root" config user.email t@t
  git -C "$root" config user.name t
  printf '.swarmforge/\n' > "$root/.gitignore"
  git -C "$root" add .gitignore
  git -C "$root" -c core.hooksPath=/dev/null commit -q --no-verify -m init
  printf 'v1\n' > "$root/extension/src/board.ts"
  git -C "$root" add extension/src/board.ts
}

# Runs the guard with an injected suite that prints $2 and exits $3.
run_guard() {
  local root="$1" body="$2" code="$3"
  ( cd "$root" && bash "$GUARD" bash -c "printf '%s\n' \"\$0\"; exit $code" "$body" 2>&1 )
}

retained_logs() {
  local root="$1"
  ls -1 "$root/$RETAIN_REL"/refusal-*.log 2>/dev/null | sort
}

# ── 01: a refusal retains the output and names the path ──────────────────
R1="$WORK/one"
mk_repo "$R1"
OUT1="$(run_guard "$R1" 'FAIL extension/test/bl1275probe.property.test.js > assertion body one' 1)"
RC1=$?
if (( RC1 != 0 )); then
  pass "a non-allowlisted red still refuses the commit (exit $RC1)"
else
  fail "the injected red did not refuse the commit"
fi

NAMED="$(printf '%s\n' "$OUT1" | sed -n 's/.*retained at \(.*\)$/\1/p' | tail -1)"
if [[ -n "$NAMED" ]]; then
  pass "the refusal names a path to the retained output"
else
  fail "the refusal names no retained-output path; got: $(printf '%s' "$OUT1" | tr '\n' '|' | tail -c 300)"
fi

if [[ -n "$NAMED" && -f "$NAMED" ]] && grep -q 'assertion body one' "$NAMED"; then
  pass "the file at the named path holds the injected suite's failing line"
else
  fail "no readable retained output at '${NAMED:-<none>}' containing the failing line"
fi

# ── 02: successive refusals do not overwrite each other ──────────────────
R2="$WORK/two"
mk_repo "$R2"
for body in 'FAIL bl968 first body' 'FAIL bl955 second body' 'FAIL bl787 third body'; do
  run_guard "$R2" "$body" 1 >/dev/null 2>&1
done
KEPT2="$(retained_logs "$R2")"
COUNT2="$(printf '%s' "$KEPT2" | grep -c . || true)"
if (( COUNT2 == 3 )); then
  pass "three successive refusals leave three separate logs"
else
  fail "expected 3 retained logs after 3 refusals, found $COUNT2"
fi
MISSING=""
for needle in 'first body' 'second body' 'third body'; do
  grep -rq "$needle" "$R2/$RETAIN_REL" 2>/dev/null || MISSING="$MISSING $needle"
done
if [[ -z "$MISSING" ]]; then
  pass "each refusal's own output is still readable - none clobbered"
else
  fail "clobbered refusal output, missing:$MISSING"
fi

# ── 03: a green run retains nothing ──────────────────────────────────────
R3="$WORK/three"
mk_repo "$R3"
run_guard "$R3" 'all green' 0 >/dev/null 2>&1
if [[ -z "$(retained_logs "$R3")" ]]; then
  pass "a green run retains no output"
else
  fail "a green run retained output it had no refusal to justify"
fi

# ── 04: retention never touches the tracked tree, and is bounded ─────────
R4="$WORK/four"
mk_repo "$R4"
BEFORE_STATUS="$(git -C "$R4" status --porcelain)"
KEEP=3
for i in 1 2 3 4 5; do
  ( cd "$R4" && SWARMFORGE_PROPERTY_GUARD_REFUSAL_KEEP="$KEEP" \
      bash "$GUARD" bash -c "printf '%s\n' \"\$0\"; exit 1" "FAIL body number $i" ) >/dev/null 2>&1
done
AFTER_STATUS="$(git -C "$R4" status --porcelain)"
if [[ "$BEFORE_STATUS" == "$AFTER_STATUS" ]]; then
  pass "five refusals left the tracked working tree byte-identical"
else
  fail "retention changed the tracked tree; before='$BEFORE_STATUS' after='$AFTER_STATUS'"
fi

COUNT4="$(retained_logs "$R4" | grep -c . || true)"
if (( COUNT4 == KEEP )); then
  pass "retention is bounded: $KEEP kept out of 5 refusals"
else
  fail "expected $KEEP retained logs under the bound, found $COUNT4"
fi

if grep -rq 'body number 5' "$R4/$RETAIN_REL" 2>/dev/null \
   && ! grep -rq 'body number 1' "$R4/$RETAIN_REL" 2>/dev/null; then
  pass "the bound prunes the OLDEST refusals and keeps the most recent"
else
  fail "pruning kept the wrong end of the range"
fi

# ── 05: nothing the guard retains is stageable, whatever the repo ignores ─
# The real repo gitignores .swarmforge/, but invariant 2 must not rest on
# that: a checkout without that line must still be unable to commit a log.
R5="$WORK/five"
mkdir -p "$R5/extension/src"
git -C "$R5" init -q
git -C "$R5" config user.email t@t
git -C "$R5" config user.name t
git -C "$R5" -c core.hooksPath=/dev/null commit -q --no-verify --allow-empty -m init
printf 'v1\n' > "$R5/extension/src/board.ts"
git -C "$R5" add extension/src/board.ts
run_guard "$R5" 'FAIL no-outer-gitignore' 1 >/dev/null 2>&1
if [[ -n "$(retained_logs "$R5")" ]]; then
  pass "the log is retained even with no .swarmforge/ ignore rule"
else
  fail "no log retained in a repo without a .swarmforge/ ignore rule"
fi
if git -C "$R5" status --porcelain | grep -q 'swarmforge'; then
  fail "a retained log is visible to git in a repo that does not ignore .swarmforge/"
else
  pass "a retained log is unstageable even with no outer ignore rule"
fi

# ── 06: the DEFAULT bound is real, not something only the tests set ──────
# Scenario 04 lowers the bound through the seam so "more than the bound" is
# five runs rather than twenty-one. That must not be the only bound anyone
# ever exercises, so the shipped default is asserted here directly.
DECLARED_DEFAULT="$(sed -n 's/^REFUSAL_LOG_KEEP_DEFAULT=\([0-9][0-9]*\)$/\1/p' "$GUARD")"
if [[ "$DECLARED_DEFAULT" == "20" ]]; then
  pass "the script declares a default retention bound of 20"
else
  fail "expected a declared default bound of 20, found '${DECLARED_DEFAULT:-<none>}'"
fi

R6="$WORK/six"
mk_repo "$R6"
for i in 1 2 3; do
  run_guard "$R6" "FAIL default-bound run $i" 1 >/dev/null 2>&1
done
COUNT6="$(retained_logs "$R6" | grep -c . || true)"
if (( COUNT6 == 3 )); then
  pass "with no seam set, the default bound keeps all three refusals"
else
  fail "expected 3 retained logs under the default bound, found $COUNT6"
fi

exit "$status"
