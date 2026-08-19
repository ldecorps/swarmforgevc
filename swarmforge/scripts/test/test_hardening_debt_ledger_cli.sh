#!/usr/bin/env bash
# BL-942: wiring test for hardening_debt_ledger_update.bb (--defer, the ONE
# mechanical way a hardening pass records a deferred gate) and
# hardening_debt_ledger_read.bb (the ledger's own machine-readable reader,
# scenario 04) - the two CLI entry points end-to-end, not just the pure lib.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFER_CLI="$SCRIPT_DIR/../hardening_debt_ledger_update.bb"
READ_CLI="$SCRIPT_DIR/../hardening_debt_ledger_read.bb"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
mkdir -p "$ROOT/backlog"

ledger() { cat "$ROOT/backlog/hardening-debt-ledger.yaml" 2>/dev/null; }
row_count() { grep -c '^- parcel:' "$ROOT/backlog/hardening-debt-ledger.yaml" 2>/dev/null || true; }

# ── --defer: appends a row naming the parcel, gate, file set, reason, load ─
bb "$DEFER_CLI" "$ROOT" --defer BL-915 mutation "a.ts,b.ts" "host load above busy threshold" "44.47/27.77/22.49" 2026-08-19 >/dev/null
check "defer: row appended" "[[ \"\$(row_count)\" -eq 1 ]]"
check "defer: parcel recorded" '[[ "$(ledger)" == *"parcel: BL-915"* ]]'
check "defer: gate recorded" '[[ "$(ledger)" == *"gate: mutation"* ]]'
check "defer: file set recorded" '[[ "$(ledger)" == *"file_set: a.ts,b.ts"* ]]'
check "defer: load measurement recorded" '[[ "$(ledger)" == *"44.47/27.77/22.49"* ]]'

# ── a second --defer for the SAME gate+file-set is idempotent, never a
#    duplicate row, even from a DIFFERENT parcel (scenario 03) ─────────────
bb "$DEFER_CLI" "$ROOT" --defer BL-916 mutation "b.ts,a.ts" "host load above busy threshold" "50/40/30" 2026-08-19 >/dev/null
check "defer: same gate+file-set (different order, different parcel) does not duplicate" \
  "[[ \"\$(row_count)\" -eq 1 ]]"
check "defer: the FIRST parcel's row is the one that survives" '[[ "$(ledger)" == *"parcel: BL-915"* ]]'

# ── a different gate for the same file set IS a new row ───────────────────
bb "$DEFER_CLI" "$ROOT" --defer BL-917 CRAP "a.ts,b.ts" "host load above busy threshold" "44.47/27.77/22.49" 2026-08-19 >/dev/null
check "defer: a different gate for the same files is a separate row" "[[ \"\$(row_count)\" -eq 2 ]]"

# ── missing arguments fall through to usage, never a crash ────────────────
set +e
bb "$DEFER_CLI" "$ROOT" --defer BL-918 mutation >/dev/null 2>&1
NO_ARGS_EXIT=$?
set -e
check "defer: missing reason/load exits nonzero via usage, not a crash" '[[ "$NO_ARGS_EXIT" -ne 0 ]]'
check "defer: a failed attempt adds no row" "[[ \"\$(row_count)\" -eq 2 ]]"

# ── --read: machine-readable JSON, without touching any evidence file ─────
READ_OUT="$(bb "$READ_CLI" "$ROOT")"
check "read: returns valid JSON naming both parcels" \
  '[[ "$READ_OUT" == *"\"parcel\":\"BL-915\""* && "$READ_OUT" == *"\"parcel\":\"BL-917\""* ]]'
check "read: file_set comes back as a JSON array, not a comma string" \
  '[[ "$READ_OUT" == *"\"file_set\":[\"a.ts\",\"b.ts\"]"* ]]'

READ_ONE="$(bb "$READ_CLI" "$ROOT" --parcel BL-915)"
check "read --parcel: scopes to just that parcel" \
  '[[ "$READ_ONE" == *"BL-915"* && "$READ_ONE" != *"BL-917"* ]]'

# ── a gate that RAN (no --defer call at all) leaves no row - proven by a
#    fresh root that never sees a --defer call ─────────────────────────────
QUIET_ROOT="$(mktemp -d)"
register_tmp_dir "$QUIET_ROOT"
mkdir -p "$QUIET_ROOT/backlog"
QUIET_OUT="$(bb "$READ_CLI" "$QUIET_ROOT")"
check "read: a root with no deferrals reads back an empty debt list" '[[ "$QUIET_OUT" == "[]" ]]'

# ── the reader never needs backlog/evidence/ to exist at all (scenario 04's
#    "no evidence markdown file is consulted" - proven structurally: this
#    root has no evidence directory whatsoever and the reader still works) ─
check "no evidence directory was created by either CLI" '[[ ! -d "$ROOT/backlog/evidence" ]]'

if [[ "$fail" -eq 0 ]]; then
  echo "hardening_debt_ledger CLI wiring: ALL CHECKS PASSED"
else
  echo "hardening_debt_ledger CLI wiring: FAILURES"; exit 1
fi
