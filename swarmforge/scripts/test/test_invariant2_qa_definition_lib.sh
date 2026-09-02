#!/usr/bin/env bash
# BL-1314: unit tests for invariant2_qa_definition_lib.sh - the extracted
# BL-925 invariant 2 pin ("there is ONE definition of QA-approved tip; a
# second predicate answering the same question differently is the defect").
#
# The predicate is a pure text check over two named files, so every case here
# drives the REAL function against throwaway fixture files rather than against
# the live tree - which is exactly what the live tree could not give us: the
# regression this ticket fixes (an unrelated third ancestry question added to
# handoffd.bb) is not expressible by mutating the checked-in file in place.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$SCRIPT_DIR/../invariant2_qa_definition_lib.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# shellcheck source=../invariant2_qa_definition_lib.sh
source "$LIB"

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

GUARD="$ROOT/check_pipeline_code_on_main.sh"
HANDOFFD="$ROOT/handoffd.bb"

# The shapes each file has on main today: both reach the QA question through
# the one shared script and neither re-answers it inline.
write_clean_guard() {
  cat > "$GUARD" <<'EOF'
#!/usr/bin/env bash
if bash "$SCRIPT_DIR/is_qa_ancestor.sh" "$sha"; then
  echo approved
fi
EOF
}

write_clean_handoffd() {
  cat > "$HANDOFFD" <<'EOF'
#!/usr/bin/env bb
(defn qa-ancestor? [sha]
  (sh! ["bash" (str (fs/path script-dir "is_qa_ancestor.sh")) sha]))
EOF
}

# Runs the predicate and reports its exit status plus its output, without
# letting a nonzero status abort the test under `set -e`.
run_check() {
  CHECK_OUT=""
  CHECK_STATUS=0
  CHECK_OUT="$(inv2_qa_definition_violations "$GUARD" "$HANDOFFD" 2>&1)" || CHECK_STATUS=$?
}

# ── 01: the shape on main today passes ────────────────────────────────────
write_clean_guard
write_clean_handoffd
run_check
[[ "$CHECK_STATUS" -eq 0 ]] || fail "clean tree reported a violation: $CHECK_OUT"
[[ -z "$CHECK_OUT" ]] || fail "clean tree printed output: $CHECK_OUT"
pass "01 clean: both files reach the QA question through the one shared script"

# ── 02: an ancestry call about ANY OTHER pair of refs is not a violation ──
# This is the regression the ticket exists for. Both helpers are real, quoted
# from handoffd.bb as it stands: BL-1130's origin/main-versus-HEAD check and
# BL-668's generic fast-forward helper.
write_clean_guard
write_clean_handoffd
cat >> "$HANDOFFD" <<'EOF'
(defn master-main-origin-is-ancestor? []
  (zero? (:exit (sh! ["git" "merge-base" "--is-ancestor" "origin/main" "HEAD"]))))
(defn git-is-ancestor? [dir ancestor descendant]
  (zero? (:exit (sh! ["git" "merge-base" "--is-ancestor" ancestor descendant] {:dir dir}))))
EOF
run_check
[[ "$CHECK_STATUS" -eq 0 ]] || fail "an ancestry call over another ref pair was reported as a violation: $CHECK_OUT"
pass "02 other-questions: ancestry over origin/main-vs-HEAD and a generic ref pair is not a second QA definition"

# ── 03: a THIRD unrelated ancestry question is still not a violation ──────
# The ticket's own regression case: the fix must not be a two-helper
# allowlist that fails again the next time a helper is added (BL-973 shape).
write_clean_guard
write_clean_handoffd
cat >> "$HANDOFFD" <<'EOF'
(defn some-future-helper? []
  (zero? (:exit (sh! ["git" "merge-base" "--is-ancestor" "refs/heads/foo" "HEAD"]))))
EOF
run_check
[[ "$CHECK_STATUS" -eq 0 ]] || fail "a fourth ancestry helper over an unrelated ref pair failed the assertion: $CHECK_OUT"
pass "03 third-question: a newly added helper over an unrelated ref pair does not fail the pin"

# ── 04/05: a second INLINE answer to the QA question is still a violation ─
write_clean_guard
write_clean_handoffd
cat >> "$HANDOFFD" <<'EOF'
(defn sneaky-qa? [sha]
  (zero? (:exit (sh! ["git" "merge-base" "--is-ancestor" sha "swarmforge-QA"]))))
EOF
run_check
[[ "$CHECK_STATUS" -ne 0 ]] || fail "an inline QA-question ancestry call in handoffd.bb was not caught"
grep -q "handoffd.bb" <<<"$CHECK_OUT" || fail "the violation does not name handoffd.bb: $CHECK_OUT"
pass "04 inline-qa-handoffd: a second inline answer to the QA question is still a violation, and is named"

write_clean_guard
write_clean_handoffd
cat >> "$GUARD" <<'EOF'
git merge-base --is-ancestor "$SHA" swarmforge-QA
EOF
run_check
[[ "$CHECK_STATUS" -ne 0 ]] || fail "an inline QA-question ancestry call in the bash guard was not caught"
grep -q "check_pipeline_code_on_main.sh" <<<"$CHECK_OUT" || fail "the violation does not name the bash guard: $CHECK_OUT"
pass "05 inline-qa-guard: the bash half is not weakened by scoping the Babashka half"

# ── 06/07: dropping the shared definition is still a violation ────────────
write_clean_guard
write_clean_handoffd
: > "$HANDOFFD"
run_check
[[ "$CHECK_STATUS" -ne 0 ]] || fail "handoffd.bb dropping is_qa_ancestor.sh was not caught"
grep -q "handoffd.bb" <<<"$CHECK_OUT" || fail "the violation does not name handoffd.bb: $CHECK_OUT"
pass "06 dropped-handoffd: removing the shared-definition call still fails"

write_clean_guard
write_clean_handoffd
: > "$GUARD"
run_check
[[ "$CHECK_STATUS" -ne 0 ]] || fail "the bash guard dropping is_qa_ancestor.sh was not caught"
grep -q "check_pipeline_code_on_main.sh" <<<"$CHECK_OUT" || fail "the violation does not name the bash guard: $CHECK_OUT"
pass "07 dropped-guard: removing the shared-definition call still fails"

# ── 08: both halves broken at once report BOTH, not just the first ────────
# Article 4.4's shape in a predicate: a caller that stops at the first
# violation hides the rest, and this predicate is a gate.
write_clean_guard
write_clean_handoffd
: > "$GUARD"
: > "$HANDOFFD"
run_check
[[ "$CHECK_STATUS" -ne 0 ]] || fail "two simultaneous violations were not caught"
grep -q "check_pipeline_code_on_main.sh" <<<"$CHECK_OUT" || fail "the bash-guard violation is missing: $CHECK_OUT"
grep -q "handoffd.bb" <<<"$CHECK_OUT" || fail "the handoffd.bb violation is missing: $CHECK_OUT"
pass "08 complete-inventory: both violations are reported in one run, not just the first"

# ── 09: the live tree passes ──────────────────────────────────────────────
# The same call the standing guard test makes, against the real files.
LIVE_STATUS=0
LIVE_OUT="$(inv2_qa_definition_violations \
  "$SCRIPT_DIR/../check_pipeline_code_on_main.sh" \
  "$SCRIPT_DIR/../handoffd.bb" 2>&1)" || LIVE_STATUS=$?
[[ "$LIVE_STATUS" -eq 0 ]] || fail "the live tree reports a violation: $LIVE_OUT"
pass "09 live-tree: handoffd.bb and check_pipeline_code_on_main.sh as they stand pass the pin"

echo "ALL PASS: invariant2_qa_definition_lib"
