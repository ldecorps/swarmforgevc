#!/usr/bin/env bash
# BL-436: fleet_telegram_creds_lib.bb - per-swarm Telegram creds resolution
# (acceptance scenarios 01-04). Pure temp-dir fixtures throughout; never
# touches the real $HOME.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER="$SCRIPT_DIR/fleet_telegram_creds_lib_test_runner.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }

OUT="$(bb "$RUNNER" 2>&1)" || { echo "$OUT"; fail "fleet_telegram_creds_lib_test_runner.bb exited non-zero"; }
echo "$OUT"
echo "$OUT" | grep -q "ALL TESTS PASSED" || fail "expected all fleet_telegram_creds_lib assertions to pass"

echo "PASS: fleet_telegram_creds_lib (BL-436) - all assertions passed"
