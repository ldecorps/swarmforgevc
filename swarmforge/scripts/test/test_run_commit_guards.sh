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
RUNNER="$SCRIPT_DIR/../run_commit_guards.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

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

ALL_GUARDS="check_commit_size.sh check_ticket_deletion.sh check_pipeline_code_on_main.sh check_feature_handler_registration.sh check_property_suite_drift.sh"

reset_fixture() {
  rm -rf "$GUARDS" "$RAN"
  mkdir -p "$GUARDS" "$RAN"
  rm -f "$ROOT"/exit-*
  for g in $ALL_GUARDS; do write_stub "$g"; done
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

# ── case 01: nothing violates - allowed, and the property guard DID run ──────
reset_fixture
run_runner
[ "$STATUS" -eq 0 ] || fail "01: a clean commit was refused (status $STATUS): $OUT"
ran check_property_suite_drift.sh || fail "01: deferring the property guard silently skipped it"
pass "01 a clean commit is allowed and still pays for the property suite"

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

# ── case 04: every cheap guard refuses ──────────────────────────────────────
reset_fixture
set_exit check_commit_size.sh 1
set_exit check_ticket_deletion.sh 1
set_exit check_pipeline_code_on_main.sh 1
set_exit check_feature_handler_registration.sh 1
run_runner
[ "$STATUS" -ne 0 ] || fail "04: a quadruply-violating commit was allowed"
for g in check_commit_size.sh check_ticket_deletion.sh check_pipeline_code_on_main.sh check_feature_handler_registration.sh; do
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
grep -qE '^\s*"\$REPO_ROOT/swarmforge/scripts/check_(commit_size|ticket_deletion|pipeline_code_on_main|feature_handler_registration|property_suite_drift)\.sh"' "$HOOK" \
  && fail "10: pre-commit still calls a guard directly, bypassing the runner"
pass "10 the pre-commit hook delegates to run_commit_guards.sh"

echo "ALL PASS: run_commit_guards.sh"
