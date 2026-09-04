#!/usr/bin/env bash
# BL-1388: the land-step runner's tree-guard fixture describes the guard as it
# stands under discovery (BL-1371), so the runner is trustworthy again.
#
# The fixture used to build its refusal case as a discoverable handler beside
# an empty DOMAINS array - unregistered under the hand-maintained registry,
# registered under discovery. The guard changed on 2026-09-03 and the runner
# has reported "2 failure(s)" on every run since, with nothing wrong in
# production. Every check below runs the REAL runner and the REAL guard.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
RUNNER="$REPO_ROOT/swarmforge/scripts/test/land_step_lib_test_runner.bb"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

FIXTURE_PREFIX="sfvc-bl1388-e2e"
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1388_SUITE_BOUND_SECONDS:-900}" "$@"
trap 'rm -rf "$WORK"' EXIT

# ── 1. the runner is green ───────────────────────────────────────────────
out="$(cd "$REPO_ROOT" && timeout 600 bb "$RUNNER" 2>&1)"; rc=$?
if (( rc == 0 )) && ! grep -q '^FAIL' <<<"$out"; then
  pass "the land-step test runner exits zero with no failing assertion"
else
  fail "the runner is still red (rc=$rc): $(grep '^FAIL' <<<"$out" | head -2)"
fi

# ── 2. the refusal case measures the guard, not the fixture ──────────────
# Give the refusal case a name discovery DOES reach: both refusal assertions
# must fail. A fixture that passed either way would prove nothing.
# Beside the real runner, not in $WORK: the runner load-files its siblings
# relative to its OWN path, so a copy anywhere else dies at load rather than
# at the assertion this check is about. Removed in the trap below, and named
# with this run's pid so concurrent runs never share one.
probe="$SCRIPT_DIR/.bl1388-probe-$$.bb"
trap 'rm -rf "$WORK"; rm -f "$probe"' EXIT
# Only the FIRST occurrence: the rename case below deliberately starts from
# the undiscoverable name and would throw on a missing file, which is a crash,
# not the assertion failure this check is looking for.
awk -v done=0 '
  !done && /fixture-tree-on-replay-branch! root "specs\/pipeline\/steps\/bl9009Fixture.js"/ {
    sub(/bl9009Fixture\.js/, "bl9009FixtureSteps.js"); done = 1
  }
  { print }
' "$RUNNER" > "$probe"
out="$(cd "$REPO_ROOT" && timeout 600 bb "$probe" 2>&1)"; rc=$?
if (( rc != 0 )) && grep -q '^FAIL.*refuses a handler discovery cannot reach' <<<"$out"; then
  pass "a discoverable handler makes the refusal assertions fail (the fixture measures the guard)"
else
  fail "the refusal case passes whatever the handler is named (rc=$rc)"
fi

# ── 3. the real guard path, not an injected tree-guards-fn ───────────────
# The block's whole point (its own header) is that the DEFAULT wiring reaches
# check_feature_handler_registration.sh on a non-main tree.
block="$(sed -n '/the REAL guard wiring, not the injected one/,/pinned so the fixture cannot drift back/p' "$RUNNER")"
# Comment lines are stripped first: the block's header explains WHY it does
# not inject a tree-guards-fn, and that prose must not read as an injection.
code="$(grep -v '^[[:space:]]*;;' <<<"$block")"
if grep -q 'run-replayed-tree-guards root)' <<<"$code" && ! grep -q 'tree-guards-fn' <<<"$code"; then
  pass "the block still calls run-replayed-tree-guards with no injected tree-guards-fn"
else
  fail "the fixture no longer drives the real guard path"
fi
if grep -q 'land-replay/BL-9001' <<<"$block"; then
  pass "and still assesses a non-main tree (the land-replay branch)"
else
  fail "the fixture no longer builds a non-main tree, so --assume-main is untested"
fi

# ── 4. only the fixture block changed ────────────────────────────────────
# qa_e2e item 4: every other assertion in the runner is untouched.
changed="$(cd "$REPO_ROOT" && git diff main -- swarmforge/scripts/test/land_step_lib_test_runner.bb \
           | grep -cE '^[+-][^+-]' || true)"
outside="$(cd "$REPO_ROOT" && git diff main -U0 -- swarmforge/scripts/test/land_step_lib_test_runner.bb \
           | grep -E '^[+-][[:space:]]*\(assert' \
           | grep -vcE 'BL-1388|BL-1375: the real tree guard refuses an unregistered handler|BL-1375: and the refusal names the offending feature|BL-1375: and a self-consistent tree passes' || true)"
if (( changed > 0 )) && (( outside == 0 )); then
  pass "no assertion outside the fixture block changed"
else
  fail "the diff touches assertions outside the fixture block (${outside} lines)"
fi

# ── 5. the retired premise is gone from the block ────────────────────────
if grep -q 'DOMAINS' <<<"$block" && grep -q 'not refused' "$RUNNER"; then
  pass "the empty-array tree is pinned as PASSING, the premise BL-1371 established"
else
  fail "the block no longer pins what an empty registry array means today"
fi

if (( status == 0 )); then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
