#!/usr/bin/env bash
# BL-1303: the feature-handler registration guard, driven against REAL scratch
# repositories on real branches. The decision logic has its own unit tests
# (extension/test/featureHandlerRegistrationCheck.test.js); what these cases
# pin is the shell guard's own contract - the branch gate, the fail-closed
# paths, and that ONE refusal names every offender.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$SCRIPT_DIR/../check_feature_handler_registration.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# A hook exports GIT_DIR; a leaked one from this test's own shell would point
# every scratch repo's git at the wrong place (the guard unsets both itself -
# this keeps the fixture honest about what it built).
unset GIT_DIR GIT_WORK_TREE

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

# Builds a scratch repo on $branch carrying $n feature files, each with its
# own ticket-named handler file; handlers named in $registered are the ones
# index.js requires.
build_repo() {
  local name="$1" branch="$2" count="$3"
  shift 3
  local registered=("$@")
  local repo="$ROOT/$name"
  rm -rf "$repo"
  mkdir -p "$repo/specs/features" "$repo/specs/pipeline/steps/lib"

  local i
  for ((i = 1; i <= count; i++)); do
    echo "Feature: fixture $i" > "$repo/specs/features/BL-90$i-fixture.feature"
    echo "module.exports = { registerSteps() {} };" > "$repo/specs/pipeline/steps/bl90${i}FixtureSteps.js"
  done

  {
    echo "const DOMAINS = ["
    local handler
    for handler in ${registered[@]+"${registered[@]}"}; do
      echo "  require('./${handler}'),"
    done
    echo "];"
  } > "$repo/specs/pipeline/steps/index.js"

  git -C "$repo" init -q
  git -C "$repo" checkout -q -b "$branch"
  git -C "$repo" add -A
  git -C "$repo" -c user.email=t@t -c user.name=t commit -q -m "fixture"
  echo "$repo"
}

run_guard() {
  OUT=""
  STATUS=0
  OUT="$(bash "$GUARD" "$1" 2>&1)" || STATUS=$?
}

names() { printf '%s' "$OUT" | grep -q -- "$1"; }

# ── 01: every handler registered - allowed through ──────────────────────────
repo="$(build_repo clean main 1 bl901FixtureSteps)"
run_guard "$repo"
[ "$STATUS" -eq 0 ] || fail "01: a runnable tree was refused: $OUT"
[ -z "$OUT" ] || fail "01: a passing guard reported an offending feature: $OUT"
pass "01 a feature whose handler is registered is allowed through"

# ── 02: handler present, registration absent - refused, both named ──────────
repo="$(build_repo unregistered main 1)"
run_guard "$repo"
[ "$STATUS" -eq 1 ] || fail "02: an unrunnable tree was allowed (status $STATUS): $OUT"
names "BL-901-fixture.feature" || fail "02: refusal did not name the feature file: $OUT"
names "bl901FixtureSteps.js" || fail "02: refusal did not name the unregistered handler: $OUT"
pass "02 an unregistered handler is refused, naming the feature and the handler"

# ── 03: a registered handler's sibling script is missing ────────────────────
repo="$(build_repo sibling main 1 bl901FixtureSteps)"
cat > "$repo/specs/pipeline/steps/bl901FixtureSteps.js" <<'HANDLER'
const path = require('node:path');
const CLI = path.join(__dirname, 'lib', 'bl901FixtureCli.sh');
module.exports = { registerSteps() {}, CLI };
HANDLER
git -C "$repo" add -A
git -C "$repo" -c user.email=t@t -c user.name=t commit -q -m "reach for a lib script"
run_guard "$repo"
[ "$STATUS" -eq 1 ] || fail "03: a handler reaching for an absent lib script was allowed: $OUT"
names "bl901FixtureCli.sh" || fail "03: refusal did not name the missing sibling script: $OUT"

printf '#!/usr/bin/env bash\n' > "$repo/specs/pipeline/steps/lib/bl901FixtureCli.sh"
run_guard "$repo"
[ "$STATUS" -eq 0 ] || fail "03: restoring the sibling script did not clear the refusal: $OUT"
pass "03 a missing sibling script is refused by name, and its return clears the refusal"

# ── 04: one pass reports EVERY offender ─────────────────────────────────────
for offenders in 2 3; do
  repo="$(build_repo "many$offenders" main "$offenders")"
  run_guard "$repo"
  [ "$STATUS" -eq 1 ] || fail "04: $offenders unrunnable features were allowed: $OUT"
  for ((i = 1; i <= offenders; i++)); do
    names "BL-90$i-fixture.feature" || fail "04: refusal stopped before feature $i: $OUT"
  done
  names "$offenders offending artifact" || fail "04: refusal did not report the count: $OUT"
done
pass "04 one pass names every offending feature file, not only the first"

# ── 05: silent on a branch other than main ──────────────────────────────────
repo="$(build_repo offmain swarmforge-coder 1)"
run_guard "$repo"
[ "$STATUS" -eq 0 ] || fail "05: the guard refused on a branch other than main: $OUT"
[ -z "$OUT" ] || fail "05: the guard spoke on a branch other than main: $OUT"
pass "05 the guard is silent on a branch other than main"

# ── 05b: --assume-main assesses a non-main branch (BL-1375) ────────────────
# The land step's tip-pure replay stands on a scratch `land-replay/...` branch
# while BEING the tree about to become main's tip. Case 05 above is exactly
# why it cannot be assessed without saying so: the branch gate would exit 0 on
# the name alone and the land would collect a pass the guard never performed.
run_guard_assume_main() {
  OUT=""
  STATUS=0
  OUT="$(bash "$GUARD" "$1" --assume-main 2>&1)" || STATUS=$?
}

repo="$(build_repo replay_bad land-replay/BL-9001-abc123 1)"
run_guard_assume_main "$repo"
[ "$STATUS" -eq 1 ] || fail "05b: --assume-main did not assess an unrunnable replay tree: $OUT"
names "BL-901-fixture.feature" || fail "05b: refusal did not name the offending feature: $OUT"

repo="$(build_repo replay_good land-replay/BL-9001-abc123 1 bl901FixtureSteps)"
run_guard_assume_main "$repo"
[ "$STATUS" -eq 0 ] || fail "05b: --assume-main refused a self-consistent replay tree: $OUT"
pass "05b --assume-main assesses a replay branch, and still passes a consistent tree"

# The flag must not be mistaken for the repo root when it comes first.
repo="$(build_repo replay_argorder land-replay/BL-9001-abc123 1)"
OUT=""
STATUS=0
OUT="$(bash "$GUARD" --assume-main "$repo" 2>&1)" || STATUS=$?
[ "$STATUS" -eq 1 ] || fail "05c: --assume-main before the root was misread: $OUT"
names "BL-901-fixture.feature" || fail "05c: refusal did not name the offending feature: $OUT"
pass "05c --assume-main is recognised in either argument position"

# ── 06: an unreadable step registry is refused, never waved through ─────────
repo="$(build_repo noregistry main 1 bl901FixtureSteps)"
rm "$repo/specs/pipeline/steps/index.js"
run_guard "$repo"
[ "$STATUS" -eq 1 ] || fail "06: a tree with no readable step registry was allowed: $OUT"
names "unreadable step registry" || fail "06: refusal did not name the unreadable registry: $OUT"
pass "06 an unreadable step registry is a refusal naming it"

# ── 07: the checker itself missing is a refusal, not a pass ────────────────
# (the guard resolves the checker from its OWN checkout, so this drives a copy
# of the guard placed where no compiled checker sits beside it)
STANDIN="$ROOT/standin/swarmforge/scripts"
mkdir -p "$STANDIN"
cp "$GUARD" "$STANDIN/"
repo="$(build_repo checkerless main 1 bl901FixtureSteps)"
OUT=""
STATUS=0
OUT="$(bash "$STANDIN/check_feature_handler_registration.sh" "$repo" 2>&1)" || STATUS=$?
[ "$STATUS" -eq 1 ] || fail "07: a guard that could not run its checker allowed the commit: $OUT"
names "fails closed" || fail "07: refusal did not say why it could not run: $OUT"
pass "07 a checker the guard cannot run is a refusal, never a silent pass"

echo "ALL PASS: check_feature_handler_registration.sh"
