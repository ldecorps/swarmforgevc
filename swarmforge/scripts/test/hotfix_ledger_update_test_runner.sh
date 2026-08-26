#!/usr/bin/env bash
# BL-848: wiring test for hotfix_ledger_update.bb - the ONE mechanical way a
# human/operator records the two durable, non-derivable ledger facts
# (commit->stamp-ticket link, human certification/waiver decision). This CLI
# had zero test coverage before this pass (grep across specs/, test/, docs/
# finds it named only in the how-to's own usage examples) despite being the
# exact tool the human-ask gate (invariant 3) depends on to ever close an
# entry - a bug here would either strand a real certification or corrupt the
# committed ledger silently.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../hotfix_ledger_update.bb"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
mkdir -p "$ROOT/backlog"

ledger() { cat "$ROOT/backlog/hotfix-ledger.yaml" 2>/dev/null; }
entry_count() { grep -c '^- commit:' "$ROOT/backlog/hotfix-ledger.yaml" 2>/dev/null || true; }

# ── --new: adds a fresh entry, starting pending/uncertified ────────────────
bb "$CLI" "$ROOT" --new abc1234567 "Land emergency fix" 2026-08-01 >/dev/null
check "new: entry appended" "[[ \"\$(entry_count)\" -eq 1 ]]"
check "new: commit recorded" '[[ "$(ledger)" == *"commit: abc1234567"* ]]'
check "new: starts pending" \
  "grep -A3 'commit: abc1234567' \"$ROOT/backlog/hotfix-ledger.yaml\" | grep -q 'state: pending'"
check "new: no stamp ticket yet" \
  "grep -A5 'commit: abc1234567' \"$ROOT/backlog/hotfix-ledger.yaml\" | grep -q 'stamp_ticket: null'"

# ── --new on an already-ledgered commit is refused, never silently
#    duplicated (the ledger is the durable record; a second entry for the
#    same commit would make "which one is real" ambiguous) ─────────────────
set +e
bb "$CLI" "$ROOT" --new abc1234567 "Duplicate landing" >/dev/null 2>&1
DUP_EXIT=$?
set -e
check "new: duplicate commit is rejected (nonzero exit)" '[[ "$DUP_EXIT" -ne 0 ]]'
check "new: duplicate commit does not add a second entry" "[[ \"\$(entry_count)\" -eq 1 ]]"

# ── --link: records the stamp-ticket id on an existing entry ───────────────
bb "$CLI" "$ROOT" --link abc1234567 BL-900 >/dev/null
check "link: stamp ticket recorded" \
  "grep -A5 'commit: abc1234567' \"$ROOT/backlog/hotfix-ledger.yaml\" | grep -q 'stamp_ticket: BL-900'"
check "link: still only one entry (in place update, not appended)" "[[ \"\$(entry_count)\" -eq 1 ]]"

# ── --link on a commit with no ledger entry fails loudly, never fabricates
#    one (that would defeat --new's own duplicate guard above) ─────────────
BEFORE_LINK_FAIL="$(ledger)"
set +e
bb "$CLI" "$ROOT" --link zzzzzzzzzz BL-901 >/dev/null 2>&1
LINK_MISS_EXIT=$?
set -e
check "link: unknown commit is rejected (nonzero exit)" '[[ "$LINK_MISS_EXIT" -ne 0 ]]'
check "link: unknown commit leaves the ledger untouched" \
  "[[ \"\$(ledger)\" == \"\$BEFORE_LINK_FAIL\" ]]"

# ── --decide approved: certifies, stamping human_decision + decided_at ─────
bb "$CLI" "$ROOT" --decide abc1234567 approved 2026-08-08 >/dev/null
check "decide approved: state -> certified" \
  "grep -A6 'commit: abc1234567' \"$ROOT/backlog/hotfix-ledger.yaml\" | grep -q 'state: certified'"
check "decide approved: human_decision recorded" \
  "grep -A6 'commit: abc1234567' \"$ROOT/backlog/hotfix-ledger.yaml\" | grep -q 'human_decision: approved'"
check "decide approved: decided_at recorded" \
  "grep -A6 'commit: abc1234567' \"$ROOT/backlog/hotfix-ledger.yaml\" | grep -q 'decided_at: 2026-08-08'"

# ── --decide waived: a second, independent entry can be waived without ever
#    being linked to a stamp ticket (a documented-operator-knob waiver never
#    goes through a review ticket - BL-848's own ticket body names this
#    exact case) ──────────────────────────────────────────────────────────
bb "$CLI" "$ROOT" --new def7654321 "Documented operator knob" 2026-08-02 >/dev/null
bb "$CLI" "$ROOT" --decide def7654321 waived 2026-08-08 >/dev/null
check "decide waived: state -> waived" \
  "grep -A6 'commit: def7654321' \"$ROOT/backlog/hotfix-ledger.yaml\" | grep -q 'state: waived'"
check "decide waived: never touched stamp_ticket (still null)" \
  "grep -A6 'commit: def7654321' \"$ROOT/backlog/hotfix-ledger.yaml\" | grep -q 'stamp_ticket: null'"

# ── --decide with a malformed decision value is REJECTED, never silently
#    defaulted to a safe-looking no-op or accepted case-insensitively - a
#    typo here must not certify or corrupt the entry it was aimed at ──────
BEFORE_BAD_DECIDE="$(ledger)"
set +e
bb "$CLI" "$ROOT" --decide def7654321 Approved >/dev/null 2>&1
BAD_DECIDE_EXIT=$?
set -e
check "decide: a case-mismatched decision word is rejected (nonzero exit)" \
  '[[ "$BAD_DECIDE_EXIT" -ne 0 ]]'
check "decide: a rejected decision word leaves the ledger byte-for-byte unchanged" \
  "[[ \"\$(ledger)\" == \"\$BEFORE_BAD_DECIDE\" ]]"

# ── --decide on a commit with no ledger entry fails loudly ─────────────────
set +e
bb "$CLI" "$ROOT" --decide zzzzzzzzzz approved >/dev/null 2>&1
DECIDE_MISS_EXIT=$?
set -e
check "decide: unknown commit is rejected (nonzero exit)" '[[ "$DECIDE_MISS_EXIT" -ne 0 ]]'

# ── missing arguments fall through to usage, never a crash/stack trace ─────
set +e
bb "$CLI" "$ROOT" >/dev/null 2>&1
NO_MODE_EXIT=$?
set -e
check "no mode: exits nonzero via usage, not a crash" '[[ "$NO_MODE_EXIT" -ne 0 ]]'

set +e
bb "$CLI" "$ROOT" --new abc9999999 >/dev/null 2>&1
NO_SUBJECT_EXIT=$?
set -e
check "new: missing subject exits nonzero via usage, not a crash" '[[ "$NO_SUBJECT_EXIT" -ne 0 ]]'
check "new: missing-subject attempt added no entry" "[[ \"\$(entry_count)\" -eq 2 ]]"

if [[ "$fail" -eq 0 ]]; then
  echo "hotfix_ledger_update wiring: ALL CHECKS PASSED"
else
  echo "hotfix_ledger_update wiring: FAILURES"; exit 1
fi
