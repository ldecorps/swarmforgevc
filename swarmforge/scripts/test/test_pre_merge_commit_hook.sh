#!/usr/bin/env bash
# BL-1303: pre-merge-commit is the ONLY hook git fires for a clean
# `git merge --no-ff`, which is how QA lands every approved commit and how
# both incidents this ticket cites put `main` into the bad state. The hook
# therefore has to reach the feature-handler guard itself - it does not exec
# run_commit_guards.sh, and widening the whole chain to the merge path is a
# different ticket (BL-1234's broken property-drift allowlist rides that
# chain today).
#
# The rows that gate this change are the MULTI-guard ones: a chain of two
# guards under `set -e` passes every single-violation case identically and
# only ever loses the SECOND report (BL-1242/BL-1252, and Article 4.4's
# shape applied in a gate).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/../../git-hooks/pre-merge-commit"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

GUARDS="$ROOT/guards"
RAN="$ROOT/ran"
REPO="$ROOT/repo"

git init -q -b main "$REPO"
git -C "$REPO" config user.email t@t
git -C "$REPO" config user.name t
git -C "$REPO" commit -q --allow-empty -m init

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

MERGE_GUARDS="check_pipeline_code_on_main.sh check_feature_handler_registration.sh"

reset_fixture() {
  rm -rf "$GUARDS" "$RAN"
  mkdir -p "$GUARDS" "$RAN"
  rm -f "$ROOT"/exit-*
  for g in $MERGE_GUARDS; do write_stub "$g"; done
}

set_exit() { echo "$2" > "$ROOT/exit-$1"; }

run_hook() {
  OUT=""
  STATUS=0
  OUT="$(cd "$REPO" && SWARMFORGE_COMMIT_GUARD_DIR="$GUARDS" bash "$HOOK" 2>&1)" || STATUS=$?
}

ran()   { [ -f "$RAN/$1" ]; }
names() { printf '%s' "$OUT" | grep -q -- "$1"; }

# ── case 01: the merge path reaches BOTH guards, not just the legacy one ────
reset_fixture
run_hook
[ "$STATUS" -eq 0 ] || fail "01: a clean merge was refused (status $STATUS): $OUT"
ran check_pipeline_code_on_main.sh || fail "01: the pipeline-code guard did not run on the merge path"
ran check_feature_handler_registration.sh \
  || fail "01: the feature-handler guard is NOT reached on the merge path - the hole BL-1303 closes"
pass "01 a clean merge runs both guards and is allowed"

# ── case 02: the feature-handler guard alone refuses the merge ──────────────
reset_fixture
set_exit check_feature_handler_registration.sh 1
run_hook
[ "$STATUS" -ne 0 ] || fail "02: a merge leaving a feature unrunnable was allowed"
names check_feature_handler_registration.sh || fail "02: refusal did not name the guard: $OUT"
pass "02 the feature-handler guard refuses a merge on its own"

# ── case 03: the gating row - BOTH guards refuse, BOTH still run and are ────
#    named. Under `set -e` the second guard never runs at all.
reset_fixture
set_exit check_pipeline_code_on_main.sh 1
set_exit check_feature_handler_registration.sh 1
run_hook
[ "$STATUS" -ne 0 ] || fail "03: a doubly-violating merge was allowed"
ran check_pipeline_code_on_main.sh || fail "03: the first guard never ran"
ran check_feature_handler_registration.sh \
  || fail "03: the SECOND guard never ran - the hook aborts at the first refusal"
names check_pipeline_code_on_main.sh || fail "03: refusal omitted check_pipeline_code_on_main.sh: $OUT"
names check_feature_handler_registration.sh || fail "03: refusal omitted the feature-handler guard: $OUT"
pass "03 two violations both run and both appear in ONE refusal"

# ── case 04: an earlier refusal must not skip the later guard ───────────────
reset_fixture
set_exit check_pipeline_code_on_main.sh 1
run_hook
ran check_feature_handler_registration.sh \
  || fail "04: an earlier refusal skipped the feature-handler guard"
pass "04 an earlier refusal does not skip the guard after it"

# ── case 05: an UNEXPECTED non-refusal exit still refuses the merge ─────────
reset_fixture
set_exit check_feature_handler_registration.sh 2
run_hook
[ "$STATUS" -ne 0 ] || fail "05: a guard that failed unexpectedly was collected as a pass"
names check_feature_handler_registration.sh || fail "05: refusal did not name the failing guard: $OUT"
names "unexpected" || fail "05: refusal did not distinguish an error from a refusal: $OUT"
pass "05 an unexpected exit refuses the merge and says which guard failed"

# ── case 06: a MISSING guard script refuses rather than silently passing ────
reset_fixture
rm -f "$GUARDS/check_feature_handler_registration.sh"
run_hook
[ "$STATUS" -ne 0 ] || fail "06: a missing guard script let the merge through"
names check_feature_handler_registration.sh || fail "06: refusal did not name the missing guard: $OUT"
pass "06 a missing guard script refuses the merge and is named"

# ── case 07: the refusal says pre-merge-commit, not pre-commit ──────────────
reset_fixture
set_exit check_feature_handler_registration.sh 1
run_hook
names "pre-merge-commit" || fail "07: the refusal does not name the hook that produced it: $OUT"
pass "07 the refusal names the merge hook rather than the commit hook"

# ── case 08: wiring - the hook names the guard, and does NOT widen the chain ─
grep -q 'check_feature_handler_registration.sh' "$HOOK" \
  || fail "08: pre-merge-commit does not name check_feature_handler_registration.sh (required_wiring anchor)"
# A prose mention of the chain is fine (the hook explains why it is NOT
# repointed); an INVOCATION of it is what this row forbids.
grep -qE '^[^#]*run_commit_guards\.sh' "$HOOK" \
  && fail "08: pre-merge-commit was repointed at the whole chain - out of scope (BL-1234)"
pass "08 the hook names the guard without widening the chain to every guard"

echo "ALL PASS: pre-merge-commit"
