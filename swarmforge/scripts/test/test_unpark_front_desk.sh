#!/usr/bin/env bash
# Smoke test for unpark_front_desk.sh (BL-404): the explicit, auditable
# counterpart to launch_front_desk.sh's park-flag guard. A park is a human
# decision, so lifting it must be an explicit action, never an implicit
# side effect of relaunching.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
UNPARK="$SRC/unpark_front_desk.sh"

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

# ── 1. removes an existing park flag ────────────────────────────────────────
F="$(mktemp -d)"
register_tmp_dir "$F"
mkdir -p "$F/.swarmforge/operator"
printf 'DO NOT RESTART\n' > "$F/.swarmforge/operator/front-desk-PARKED.md"
OUT="$(bash "$UNPARK" "$F" 2>&1)" && rc=0 || rc=$?
check "unpark exits 0"                              '[[ "$rc" -eq 0 ]]'
check "unpark removes the park flag"                 '[[ ! -f "$F/.swarmforge/operator/front-desk-PARKED.md" ]]'
rm -rf "$F"

# ── 2. idempotent: no park flag present -> still exits 0, no error ──────────
F="$(mktemp -d)"
register_tmp_dir "$F"
mkdir -p "$F/.swarmforge/operator"
OUT="$(bash "$UNPARK" "$F" 2>&1)" && rc=0 || rc=$?
check "unpark with no park flag present exits 0"     '[[ "$rc" -eq 0 ]]'
check "unpark with no park flag logs nothing-to-do"  '[[ "$OUT" == *"not parked"* ]]'
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "unpark_front_desk smoke: ALL CHECKS PASSED"
else
  echo "unpark_front_desk smoke: FAILURES"; exit 1
fi
