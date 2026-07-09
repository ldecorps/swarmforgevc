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

echo "ALL PASS"
