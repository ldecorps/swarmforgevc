#!/usr/bin/env bash
# BL-660: shift schedule applier + swarm_shift_lib wiring smoke test.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/swarmforge" "$ROOT/.swarmforge/operator"
printf 'config swarm_shift night\n' > "$ROOT/swarmforge/swarmforge.conf"

OUT="$(bb "$SRC/apply_shift_schedule.bb" "$ROOT" 2>&1)"
check "applier renders night shift" '[[ "$OUT" == *"\"start\":\"01:00\""* ]]'
check "applier stop 09:00" '[[ "$OUT" == *"\"stop\":\"09:00\""* ]]'

OUT2="$(bb "$SRC/apply_shift_schedule.bb" "$ROOT" 2>&1)"
check "second apply idempotent" '[[ "$OUT2" == *"\"changed\":false"* ]]'

bb "$SRC/test/swarm_shift_lib_test_runner.bb" >/dev/null
check "bb unit tests pass" 'true'

if [[ "$fail" -eq 0 ]]; then
  echo "BL-660 shift schedule smoke: ALL CHECKS PASSED"
else
  echo "BL-660 shift schedule smoke: FAILURES"
  exit 1
fi
