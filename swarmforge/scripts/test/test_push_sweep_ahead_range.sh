#!/usr/bin/env bash
# BL-1085: push-sweep ahead-range cache + single gather — fixture covering the
# acceptance scenarios. Drives the REAL push_sweep_ahead_range_lib.bb (never a
# parallel reimplementation) and greps handoffd.bb for required_wiring.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LIB_TEST="$SCRIPT_DIR/push_sweep_ahead_range_lib_test_runner.bb"
PROP="$SCRIPT_DIR/bl1085_ahead_range_property_runner.bb"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"
CLI="$SCRIPT_DIR/bl1085_ahead_range_cli.bb"

pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

# ── required_wiring: ahead-range-facts must exist AND sit in adapters ─────
grep -q 'defn ahead-range-facts!' "$HANDOFFD" \
  || fail "handoffd.bb missing defn ahead-range-facts!"
grep -q ':ahead-range-facts! ahead-range-facts!' "$HANDOFFD" \
  || fail "handoffd.bb adapters map does not wire :ahead-range-facts!"
grep -q 'push-sweep-ahead-range-lib/begin-tick!' "$HANDOFFD" \
  || fail "handoffd.bb push-sweep! does not clear the tick memo"
pass "wiring: ahead-range-facts! is defined and wired into adapters"

# ── unit + property oracles ───────────────────────────────────────────────
bb "$LIB_TEST" || fail "unit runner"
pass "01-06: unit runner (enumerate / replay / invalidate / incomplete / one-walk)"
bb "$PROP" || fail "property runner"
pass "06: property — cached verdict equals fresh gather"

# ── CLI scenarios (injectable gather counting) ────────────────────────────
bb "$CLI" || fail "bl1085_ahead_range_cli.bb"
pass "cli scenarios: first tick enumerates; replay; key changes; incomplete; one walk"

echo "ALL BL-1085 FIXTURE CHECKS PASSED"
