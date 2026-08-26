#!/usr/bin/env bash
# BL-1154: voluntary build-stale restarts must not burn the crash give-up
# attempt budget; true crash loops still reach give-up.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/.."

check() {
  local label="$1" expr="$2"
  if eval "$expr"; then
    echo "PASS: $label"
  else
    echo "FAIL: $label" >&2
    exit 1
  fi
}

OUT="$(bb swarmforge/scripts/test/front_desk_supervisor_lib_test_runner.bb)"
check "bl-1154-01: lib runner passes with BL-1154 coverage" \
  '[[ "$OUT" == *"ALL PASS"* ]]'

PROP_OUT="$(bb swarmforge/scripts/test/bl1154_build_stale_giveup_budget_property_runner.bb)"
check "bl-1154-02: property invariants hold" \
  '[[ "$PROP_OUT" == *"ALL TESTS PASSED"* ]]'

echo "test_bl1154_build_stale_not_crash_giveup_budget: ALL CHECKS PASSED"
