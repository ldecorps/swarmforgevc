#!/usr/bin/env bash
# BL-111 lint-gate-03/04: gherkin_lint_gate.sh against the real vendored
# gherkin-parser (swarmforge/vendor/aps/) - no live install/network needed,
# since the tools are already vendored in this repo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GATE="$ROOT/swarmforge/scripts/gherkin_lint_gate.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── lint-gate-04: a well-formed feature file passes ─────────────────────────
GOOD="$TMP/good.feature"
cat > "$GOOD" <<'EOF'
Feature: Sample behavior

  # BL-111 sample-scenario-01
  Scenario: something happens
    Given a precondition
    When an action occurs
    Then an outcome is observed
EOF

set +e
OUT="$(bash "$GATE" "$GOOD" "$ROOT")"
RC=$?
set -e
[[ "$RC" -eq 0 ]] || fail "04: expected exit 0 for a well-formed feature file; got $RC"
echo "$OUT" | grep -q "^OK: " || fail "04: expected an OK line; got: $OUT"
pass "04: a well-formed feature file passes the lint gate"

# ── lint-gate-03: a malformed feature file fails, reporting the error ──────
BAD="$TMP/bad.feature"
printf 'this is not a feature file at all\njust prose\n' > "$BAD"

set +e
OUT="$(bash "$GATE" "$BAD" "$ROOT" 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "03: expected a nonzero exit for a malformed feature file; got 0"
echo "$OUT" | grep -q "^FAIL: " || fail "03: expected a FAIL line reporting the parse error; got: $OUT"
pass "03: a malformed feature file fails the lint gate and reports the parse error"

# ── the gate works from a relative path too (not just absolute) ────────────
( cd "$TMP" && bash "$GATE" "good.feature" "$ROOT" ) | grep -q "^OK: " \
  || fail "the gate must resolve a relative feature-file path correctly"
pass "the gate resolves a relative feature-file path"

# ── a missing feature file fails fast with a clear error, not a bb crash ───
set +e
OUT="$(bash "$GATE" "$TMP/does-not-exist.feature" "$ROOT" 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "expected a nonzero exit for a missing feature file; got 0"
echo "$OUT" | grep -q "^Error: feature file not found:" \
  || fail "expected a clear 'feature file not found' error; got: $OUT"
pass "a missing feature file fails fast with a clear error"

# ── an un-vendored APS toolchain fails fast, naming the fix ────────────────
set +e
OUT="$(bash "$GATE" "$GOOD" "$TMP" 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "expected a nonzero exit when swarmforge/vendor/aps is missing under the given root; got 0"
echo "$OUT" | grep -q "^Error: APS tools not vendored - run install_aps_tools.sh first$" \
  || fail "expected the not-vendored error naming the fix; got: $OUT"
pass "an un-vendored APS toolchain fails fast, naming install_aps_tools.sh as the fix"

# ── BL-515: a step wrapped onto a bare 2nd line - with a <param> the ──────
# vendored parser silently drops - is rejected even though the parser
# itself reports a clean parse.
WRAPPED="$TMP/wrapped.feature"
cat > "$WRAPPED" <<'EOF'
Feature: sample

  Scenario Outline: wraps
    Given a record with <telegram> Telegram
      events out of <total> total events
    When something happens
    Then it works

    Examples:
      | telegram | total |
      | 5        | 10    |
EOF

set +e
OUT="$(bash "$GATE" "$WRAPPED" "$ROOT" 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "515-01: expected a nonzero exit for a step wrapped onto a bare 2nd line; got 0"
echo "$OUT" | grep -q "bare continuation line" \
  || fail "515-01: expected a FAIL line naming the dropped continuation line; got: $OUT"
echo "$OUT" | grep -q "events out of <total> total events" \
  || fail "515-01: expected the FAIL line to quote the dropped line text; got: $OUT"
pass "515-01: a wrapped step's dropped continuation line is rejected, not silently parsed clean"

# ── BL-515: an Examples column referenced by no step parameter is ────────
# rejected (the param-loss signature; also a phantom column on its own).
PHANTOM_COLUMN="$TMP/phantom_column.feature"
cat > "$PHANTOM_COLUMN" <<'EOF'
Feature: sample

  Scenario Outline: has an unreferenced column
    Given a value of <a>
    Then the result is checked

    Examples:
      | a | unused |
      | 1 | 2      |
EOF

set +e
OUT="$(bash "$GATE" "$PHANTOM_COLUMN" "$ROOT" 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "515-02: expected a nonzero exit for a phantom Examples column; got 0"
echo "$OUT" | grep -q '"unused"' \
  || fail "515-02: expected the FAIL line to name the unreferenced column; got: $OUT"
pass "515-02: an Examples column referenced by no step parameter is rejected"

# ── BL-515: every existing project feature file still passes the gate ────
# (no false positives from the new checks).
while IFS= read -r -d '' feature; do
  set +e
  OUT="$(bash "$GATE" "$feature" "$ROOT" 2>&1)"
  RC=$?
  set -e
  [[ "$RC" -eq 0 ]] || fail "515-03: $feature no longer passes the gate: $OUT"
done < <(find "$ROOT/specs/features" -name '*.feature' -print0)
pass "515-03: every existing specs/features/*.feature still passes the gate"

# ── BL-515: the CLI's own arg-count guard fires on a malformed invocation ─
# (never a bb crash/stacktrace) - a call site typo must fail fast and named.
set +e
OUT="$(bb "$ROOT/swarmforge/scripts/gherkin_lint_gate_cli.bb" 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "515-05: expected a nonzero exit for a missing-args CLI invocation; got 0"
echo "$OUT" | grep -q "^Usage: gherkin_lint_gate_cli.bb " \
  || fail "515-05: expected a Usage line, not a stacktrace; got: $OUT"
pass "515-05: the CLI's arg-count guard fails fast with a Usage line, not a crash"

set +e
OUT="$(bb "$ROOT/swarmforge/scripts/gherkin_lint_gate_cli.bb" one two three four five 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "515-06: expected a nonzero exit for a too-many-args CLI invocation; got 0"
echo "$OUT" | grep -q "^Usage: gherkin_lint_gate_cli.bb " \
  || fail "515-06: expected a Usage line, not a stacktrace; got: $OUT"
pass "515-06: the CLI's arg-count guard rejects too many arguments too"

echo "ALL PASS"
