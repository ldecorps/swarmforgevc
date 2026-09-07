#!/usr/bin/env bash
# BL-1252: the pre-commit guard chain must report EVERY violation in one
# refusal. These cases drive run_commit_guards.sh against a fixture guard
# directory of stubs, so the aggregation is pinned without depending on any
# real guard's predicate (which this ticket does not touch).
#
# The rows that actually gate the change are the MULTI-violation ones: a
# single-violation case passes identically before and after the fix and so
# proves nothing (engineering-detailed.prompt, "A shell chain of independent
# guards must not run under set -e").

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIVE_REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
# BL-1408: an optional seam - a scratch runner copy's path (BL-1398's own
# make_seam shape: <seam>/swarmforge/scripts/run_commit_guards.sh), never
# the live one. The derivation's repoRoot follows the seam so an added
# guard's fixture requirements (existing as a real file beside the runner)
# are checked against the SAME tree the runner itself will exec from - the
# live tree is the default and is never written by this test.
if [ -n "${1:-}" ]; then
  RUNNER="$1"
  REPO_ROOT="$(cd "$(dirname "$RUNNER")/../.." && pwd)"
else
  RUNNER="$SCRIPT_DIR/../run_commit_guards.sh"
  REPO_ROOT="$LIVE_REPO_ROOT"
fi
HELPER="$LIVE_REPO_ROOT/extension/test/helpers/commitGuardFixtureSet.js"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# BL-1408: the runner's OWN guard set, read at run time through BL-1398's
# helper - never a hand-written list here, which is what let two joined
# guards (check_handler_module_graph.sh, check_bb_scripts_load.sh,
# 2026-09-04) leave this fixture running a narrower chain than production
# and every case fail with "No such file or directory" the moment the
# runner named a guard the fixture never stubbed. Scoped to the runner
# ALONE (hookRels: []) - this test exercises run_commit_guards.sh's own
# aggregation, never the hooks, and a guard the pre-merge-commit hook runs
# on its own separate chain (e.g. check_art_director_tip.sh) is not this
# fixture's concern. The seam argument is what BL-1408's own scenarios
# 02/04 use to point the derivation at a scratch runner copy instead of
# the live one.
derive_guards() {  # derive_guards <runner-rel-to-repo-root>
  node -e '
    const { deriveCommitGuardFixtureSet } = require(process.argv[1]);
    const r = deriveCommitGuardFixtureSet({ repoRoot: process.argv[2], runnerRel: process.argv[3], hookRels: [] });
    process.stdout.write(r.guards.join(" "));
  ' "$HELPER" "$REPO_ROOT" "$1"
}

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

GUARDS="$ROOT/guards"
RAN="$ROOT/ran"
mkdir -p "$GUARDS" "$RAN"

# A stub guard records that it ran, then exits with the status its name-keyed
# file says. Absent file means 0.
write_stub() {
  local name="$1"
  cat > "$GUARDS/$name" <<STUB
#!/usr/bin/env bash
set -euo pipefail
touch "$RAN/$name"
st=0
[ -f "$ROOT/exit-$name" ] && st="\$(cat "$ROOT/exit-$name")"
[ "\$st" -eq 0 ] || echo "stub $name refusing with \$st" >&2
exit "\$st"
STUB
  chmod +x "$GUARDS/$name"
}

# BL-1408: derived from the real runner, never hand-kept - a guard the
# runner gains or loses is stubbed or dropped here with no test edit. The
# derived set is printed once so a reader can see what this run actually
# exercised.
DERIVED_GUARDS="$(derive_guards swarmforge/scripts/run_commit_guards.sh)"
echo "derived guard set: $DERIVED_GUARDS"

reset_fixture() {
  rm -rf "$GUARDS" "$RAN"
  mkdir -p "$GUARDS" "$RAN"
  rm -f "$ROOT"/exit-*
  for g in $DERIVED_GUARDS; do write_stub "$g"; done
}

set_exit() { echo "$2" > "$ROOT/exit-$1"; }

# Runs the runner, capturing combined output and status.
run_runner() {
  OUT=""
  STATUS=0
  OUT="$(SWARMFORGE_COMMIT_GUARD_DIR="$GUARDS" bash "$RUNNER" "$ROOT" 2>&1)" || STATUS=$?
}

ran()     { [ -f "$RAN/$1" ]; }
names()   { printf '%s' "$OUT" | grep -q -- "$1"; }

# ── case 01: nothing violates - allowed, and EVERY derived guard ran ────────
reset_fixture
run_runner
[ "$STATUS" -eq 0 ] || fail "01: a clean commit was refused (status $STATUS): $OUT"
for g in $DERIVED_GUARDS; do
  ran "$g" || fail "01: a clean commit never ran $g - derived from the runner, so this is not just the property guard"
done
pass "01 a clean commit is allowed and every derived guard ran"

# ── case 02: one index guard refuses - named, and the suite is NOT paid ──────
reset_fixture
set_exit check_commit_size.sh 1
run_runner
[ "$STATUS" -ne 0 ] || fail "02: an oversized commit was allowed"
names check_commit_size.sh || fail "02: refusal did not name check_commit_size.sh: $OUT"
names check_ticket_deletion.sh && fail "02: refusal named a guard that did not refuse: $OUT"
ran check_property_suite_drift.sh && fail "02: an already-refused commit paid for the property suite"
pass "02 a single index violation is named alone and does not run the property suite"

# ── case 03: the row that gates this ticket - TWO guards refuse at once ──────
reset_fixture
set_exit check_commit_size.sh 1
set_exit check_ticket_deletion.sh 1
run_runner
[ "$STATUS" -ne 0 ] || fail "03: a doubly-violating commit was allowed"
ran check_commit_size.sh || fail "03: the first guard never ran"
ran check_ticket_deletion.sh || fail "03: the SECOND guard never ran - the chain still aborts at the first refusal"
names check_commit_size.sh || fail "03: refusal omitted check_commit_size.sh: $OUT"
names check_ticket_deletion.sh || fail "03: refusal omitted check_ticket_deletion.sh: $OUT"
pass "03 two violations are both run and both named in ONE refusal"

# ── case 04: every derived guard except the suite guard refuses ────────────
# BL-1408: "the cheap tier" is every derived guard MINUS the expensive
# tier's one named member (check_property_suite_drift.sh, invariant 3 -
# the only guard this test or the property test names by hand) - never a
# separately hand-kept "cheap" list that could itself drift from the
# runner's actual membership.
reset_fixture
CHEAP_GUARDS=""
for g in $DERIVED_GUARDS; do
  [ "$g" = "check_property_suite_drift.sh" ] && continue
  CHEAP_GUARDS="$CHEAP_GUARDS $g"
  set_exit "$g" 1
done
run_runner
[ "$STATUS" -ne 0 ] || fail "04: a commit violating every cheap guard was allowed"
for g in $CHEAP_GUARDS; do
  ran "$g" || fail "04: $g never ran"
  names "$g" || fail "04: refusal omitted $g: $OUT"
done
ran check_property_suite_drift.sh && fail "04: the expensive tier was paid for a refused commit"
pass "04 every cheap-tier violation appears in one refusal"

# ── case 04b: BL-1303's guard is in the CHEAP tier, so an earlier refusal ────
#    never stops it running - the completeness the tier exists for.
reset_fixture
set_exit check_commit_size.sh 1
run_runner
ran check_feature_handler_registration.sh \
  || fail "04b: an earlier refusal skipped the feature-handler guard - it is not in the cheap tier"
pass "04b the feature-handler guard runs even when an earlier cheap guard refuses"

# ── case 05: a later guard refuses while earlier ones pass ──────────────────
reset_fixture
set_exit check_pipeline_code_on_main.sh 1
run_runner
[ "$STATUS" -ne 0 ] || fail "05: a pipeline-code violation was allowed"
names check_pipeline_code_on_main.sh || fail "05: refusal did not name the offending guard: $OUT"
names check_commit_size.sh && fail "05: refusal named a guard that passed: $OUT"
pass "05 only the guard that refused is named"

# ── case 06: an UNEXPECTED non-refusal exit still refuses, and is named ─────
reset_fixture
set_exit check_ticket_deletion.sh 2
run_runner
[ "$STATUS" -ne 0 ] || fail "06: a guard that failed unexpectedly was collected as a pass"
names check_ticket_deletion.sh || fail "06: refusal did not name the guard that failed: $OUT"
names "unexpected" || fail "06: refusal did not distinguish an error from a refusal: $OUT"
ran check_pipeline_code_on_main.sh || fail "06: a crashing guard aborted the guards after it"
pass "06 an unexpected exit refuses the commit and says which guard failed"

# ── case 07: a MISSING guard script refuses rather than silently passing ────
reset_fixture
rm -f "$GUARDS/check_ticket_deletion.sh"
run_runner
[ "$STATUS" -ne 0 ] || fail "07: a missing guard script let the commit through"
names check_ticket_deletion.sh || fail "07: refusal did not name the missing guard: $OUT"
pass "07 a missing guard script refuses the commit and is named"

# ── case 08: the expensive guard still refuses when the cheap ones pass ─────
reset_fixture
set_exit check_property_suite_drift.sh 1
run_runner
[ "$STATUS" -ne 0 ] || fail "08: property-suite drift was allowed through"
names check_property_suite_drift.sh || fail "08: refusal did not name the property guard: $OUT"
pass "08 the deferred property guard still refuses on its own"

# ── case 09: guard ORDER is unchanged - size is reported before deletion ────
reset_fixture
set_exit check_commit_size.sh 1
set_exit check_ticket_deletion.sh 1
run_runner
size_at="$(printf '%s' "$OUT" | grep -n -- 'check_commit_size.sh' | head -1 | cut -d: -f1)"
del_at="$(printf '%s' "$OUT" | grep -n -- 'check_ticket_deletion.sh' | head -1 | cut -d: -f1)"
[ -n "$size_at" ] && [ -n "$del_at" ] || fail "09: could not locate both guards in the output: $OUT"
[ "$size_at" -le "$del_at" ] || fail "09: guard order changed - deletion reported before size"
pass "09 guard order is preserved in the report"

# ── case 10: the hook actually INVOKES the runner (BL-419 wiring) ───────────
HOOK="$SCRIPT_DIR/../../git-hooks/pre-commit"
grep -q 'run_commit_guards.sh' "$HOOK" || fail "10: pre-commit does not invoke run_commit_guards.sh"
# BL-1408: matches ANY check_*.sh invoked directly, whatever the runner's
# current membership - no guard is named here by hand, so a guard joining
# or leaving the chain needs no edit to this case either.
grep -qE '^\s*"\$REPO_ROOT/swarmforge/scripts/check_[a-z_]+\.sh"' "$HOOK" \
  && fail "10: pre-commit still calls a guard directly, bypassing the runner"
pass "10 the pre-commit hook delegates to run_commit_guards.sh"

# ── case 11: the chain runs without `set -e`, so an unloadable shared lib ──
#    (BL-1303 extracted run_guard into commit_guard_chain_lib.sh) would leave
#    run_guard undefined and fall through to `exit 0` - every guard silently
#    skipped. A copy with no lib beside it must REFUSE.
reset_fixture
LONELY="$ROOT/lonely"
mkdir -p "$LONELY"
cp "$RUNNER" "$LONELY/run_commit_guards.sh"
OUT="$(SWARMFORGE_COMMIT_GUARD_DIR="$GUARDS" bash "$LONELY/run_commit_guards.sh" "$ROOT" 2>&1)" && STATUS=0 || STATUS=$?
[ "$STATUS" -ne 0 ] || fail "11: a runner whose guard chain could not be loaded allowed the commit: $OUT"
names commit_guard_chain_lib.sh || fail "11: the refusal does not say which file could not be loaded: $OUT"
ran check_commit_size.sh && fail "11: guards ran despite the chain failing to load: $OUT"
pass "11 an unloadable guard chain refuses the commit instead of skipping every guard"

echo "ALL PASS: run_commit_guards.sh"
