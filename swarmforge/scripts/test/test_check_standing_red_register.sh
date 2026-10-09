#!/usr/bin/env bash
# BL-1646: check_standing_red_register.sh (BL-1428) must (1) own a ledger
# row through the SAME (lane, file_set) register join build-report uses,
# and (2) judge only rows the commit itself authors - never a line a
# branch merge merely inherits from its OTHER parent. Fixture root is a
# real `git init` under mkdtemp (BL-1390) - never the live checkout.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$SCRIPT_DIR/../check_standing_red_register.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q -b main
git -C "$ROOT" config user.email test@test
git -C "$ROOT" config user.name test
git -C "$ROOT" config commit.gpgsign false

run_guard() {
  (cd "$ROOT" && bash "$GUARD")
}

mkdir -p "$ROOT/backlog/paused" "$ROOT/backlog/active" "$ROOT/backlog/done"

# BL-5000: the open ticket the register's own row names as owner.
echo "id: BL-5000" > "$ROOT/backlog/paused/BL-5000-owner.yaml"
: > "$ROOT/backlog/standing-reds.tsv"
: > "$ROOT/backlog/hardening-debt-ledger.yaml"
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "init: no ledger row, no register row"
BASE="$(git -C "$ROOT" rev-parse HEAD)"

# ── fixture main: adds a ledger row for a CLOSED/absent parcel (BL-4343)
#    AND a register row naming an OPEN owner (BL-5000) for the SAME
#    file_set - the exact BL-1643-owns-BL-831's-row shape ────────────────
cat > "$ROOT/backlog/hardening-debt-ledger.yaml" <<'EOF'
- parcel: BL-4343
  gate: stryker-mutation
  file_set: some/file.js
  reason: "fixture row"
  detected_at: 2026-01-01
EOF
printf 'hardening\tsome/file.js\tBL-5000\t2026-01-01\tfixture owner row\n' > "$ROOT/backlog/standing-reds.tsv"
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "main: add BL-4343 ledger row, owned by BL-5000's register row"
MAIN_WITH_OWNER="$(git -C "$ROOT" rev-parse HEAD)"

# ── fixture main-without-owner: same ledger row, but the register never
#    names an owner for it (only ever inherited, never judged) ──────────
git -C "$ROOT" checkout -q "$BASE"
git -C "$ROOT" checkout -q -b main-no-owner
cat > "$ROOT/backlog/hardening-debt-ledger.yaml" <<'EOF'
- parcel: BL-4343
  gate: stryker-mutation
  file_set: some/file.js
  reason: "fixture row"
  detected_at: 2026-01-01
EOF
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "main-no-owner: add BL-4343 ledger row, no register row at all"
MAIN_NO_OWNER="$(git -C "$ROOT" rev-parse HEAD)"

# ── the merging branch: forked BEFORE either ledger row existed, so its
#    own tip carries neither - a real branch-merge false-positive shape ──
git -C "$ROOT" checkout -q "$BASE"
git -C "$ROOT" checkout -q -b coder
git -C "$ROOT" commit -q --allow-empty -m "coder: unrelated work, no ledger/register row"

# ── 01: merging a main whose ledger row IS owned by an open register row
#    passes - the join, not the bare parcel id (BL-1646 invariant 1) ─────
git -C "$ROOT" merge -q --no-ff --no-commit "$MAIN_WITH_OWNER" || true
set +e
OUT1="$(run_guard 2>&1)"
STATUS1=$?
set -e
git -C "$ROOT" merge --abort 2>/dev/null || git -C "$ROOT" reset -q --hard coder
[[ "$STATUS1" -eq 0 ]] || fail "01: expected the merge to pass (owned via register join), got: $OUT1"
pass "01: a ledger row owned by an open register row for the same file_set passes on merge"

# ── 02: merging a main whose ledger row has NO owning register row at all
#    still passes - it is INHERITED from MERGE_HEAD, never authored by
#    this merge commit (BL-1646 invariant 2) ──────────────────────────────
git -C "$ROOT" checkout -q coder
git -C "$ROOT" merge -q --no-ff --no-commit "$MAIN_NO_OWNER" || true
set +e
OUT2="$(run_guard 2>&1)"
STATUS2=$?
set -e
git -C "$ROOT" merge --abort 2>/dev/null || git -C "$ROOT" reset -q --hard coder
[[ "$STATUS2" -eq 0 ]] || fail "02: expected the merge to pass (inherited, unowned row never authored by this commit), got: $OUT2"
pass "02: a ledger row with no owning register row still passes on merge - it is inherited, not authored"

# ── 03: a LINEAR (non-merge) commit that adds a brand-new ledger row for
#    an absent ticket, with no owning register row, is still refused ─────
git -C "$ROOT" checkout -q coder
cat > "$ROOT/backlog/hardening-debt-ledger.yaml" <<'EOF'
- parcel: BL-9999
  gate: mutation
  file_set: other/file.js
  reason: "fixture row"
  detected_at: 2026-01-01
EOF
git -C "$ROOT" add -A
set +e
OUT3="$(run_guard 2>&1)"
STATUS3=$?
set -e
git -C "$ROOT" reset -q --hard coder
[[ "$STATUS3" -ne 0 ]] || fail "03: expected refusal of a genuinely new, unowned ledger row"
echo "$OUT3" | grep "BL-9999" >/dev/null || fail "03: refusal must name BL-9999, got: $OUT3"
pass "03: a genuinely new, unowned ledger row is still refused"

# ── 04: a LINEAR commit adding a register row naming a closed/absent
#    ticket is still refused (register section regression) ──────────────
git -C "$ROOT" checkout -q coder
printf 'hardening\tanother/file.js\tBL-8888\t2026-01-01\tfixture\n' >> "$ROOT/backlog/standing-reds.tsv"
git -C "$ROOT" add -A
set +e
OUT4="$(run_guard 2>&1)"
STATUS4=$?
set -e
git -C "$ROOT" reset -q --hard coder
[[ "$STATUS4" -ne 0 ]] || fail "04: expected refusal of a new register row naming an absent ticket"
echo "$OUT4" | grep "BL-8888" >/dev/null || fail "04: refusal must name BL-8888, got: $OUT4"
pass "04: a genuinely new register row naming a closed/absent ticket is still refused"

# ── 05: a LINEAR commit adding a ledger row for an OPEN ticket by its own
#    bare parcel id (no register row at all) still passes (regression) ──
git -C "$ROOT" checkout -q coder
cat > "$ROOT/backlog/hardening-debt-ledger.yaml" <<'EOF'
- parcel: BL-5000
  gate: mutation
  file_set: yet/another/file.js
  reason: "fixture row"
  detected_at: 2026-01-01
EOF
git -C "$ROOT" add -A
set +e
OUT5="$(run_guard 2>&1)"
STATUS5=$?
set -e
git -C "$ROOT" reset -q --hard coder
[[ "$STATUS5" -eq 0 ]] || fail "05: expected a new ledger row for an open ticket (bare parcel id) to pass, got: $OUT5"
pass "05: a genuinely new ledger row for an open ticket still passes by its own bare parcel id"

# ── 06: a MERGE whose OWN resolution adds a genuinely new, unowned ledger
#    row (present in NEITHER parent) is still refused - the ticket's own
#    invariant 2 second clause, untested until now. Confirmed by hand-
#    mutation before writing this: making added_or_changed_lines return
#    empty unconditionally whenever MERGE_HEAD exists (a "just skip
#    validation during any merge" over-broad reading of invariant 2) left
#    cases 01-05 above all green - only a case where the merge's OWN
#    resolution adds new content can distinguish "inherited, so skip" from
#    "mid-merge, so skip everything".
git -C "$ROOT" checkout -q coder
git -C "$ROOT" merge -q --no-ff --no-commit "$MAIN_WITH_OWNER" || true
cat >> "$ROOT/backlog/hardening-debt-ledger.yaml" <<'EOF'
- parcel: BL-9999
  gate: mutation
  file_set: brand/new/file.js
  reason: "conflict resolution added this"
  detected_at: 2026-01-01
EOF
git -C "$ROOT" add -A
set +e
OUT6="$(run_guard 2>&1)"
STATUS6=$?
set -e
git -C "$ROOT" merge --abort 2>/dev/null || git -C "$ROOT" reset -q --hard coder
[[ "$STATUS6" -ne 0 ]] || fail "06: expected refusal of a genuinely new, unowned row added by the merge's own resolution"
echo "$OUT6" | grep "BL-9999" >/dev/null || fail "06: refusal must name BL-9999, got: $OUT6"
pass "06: a merge whose own resolution adds a genuinely new, unowned ledger row is still refused"

# ── 07: a new test-lane row whose owner declares multi-sitting with a
#    reason passes (BL-1884) ──────────────────────────────────────────────
git -C "$ROOT" checkout -q coder
cat > "$ROOT/backlog/paused/BL-5000-owner.yaml" <<'EOF'
id: BL-5000
hotfix_fallback: multi-sitting
hotfix_fallback_reason: "the fix needs a second sitting"
EOF
printf 'unit\tnewred7.test.js\tBL-5000\t2026-10-01\tfixture\n' >> "$ROOT/backlog/standing-reds.tsv"
git -C "$ROOT" add -A
set +e
OUT7="$(run_guard 2>&1)"
STATUS7=$?
set -e
git -C "$ROOT" reset -q --hard coder
[[ "$STATUS7" -eq 0 ]] || fail "07: expected a multi-sitting fallback with a reason to pass, got: $OUT7"
pass "07: a new test-lane row whose owner declares multi-sitting with a reason passes"

# ── 08: a new test-lane row whose owner declares needs-ruling with
#    ruling_options passes (BL-1884) ──────────────────────────────────────
git -C "$ROOT" checkout -q coder
cat > "$ROOT/backlog/paused/BL-5000-owner.yaml" <<'EOF'
id: BL-5000
hotfix_fallback: needs-ruling
ruling_options:
  - option-a
  - option-b
EOF
printf 'unit\tnewred8.test.js\tBL-5000\t2026-10-01\tfixture\n' >> "$ROOT/backlog/standing-reds.tsv"
git -C "$ROOT" add -A
set +e
OUT8="$(run_guard 2>&1)"
STATUS8=$?
set -e
git -C "$ROOT" reset -q --hard coder
[[ "$STATUS8" -eq 0 ]] || fail "08: expected a needs-ruling fallback with ruling_options to pass, got: $OUT8"
pass "08: a new test-lane row whose owner declares needs-ruling with ruling_options passes"

# ── 09: a new test-lane row whose owner declares no hotfix_fallback is
#    refused, naming the row (BL-1884) ────────────────────────────────────
git -C "$ROOT" checkout -q coder
cat > "$ROOT/backlog/paused/BL-5000-owner.yaml" <<'EOF'
id: BL-5000
EOF
printf 'unit\tnewred9.test.js\tBL-5000\t2026-10-01\tfixture\n' >> "$ROOT/backlog/standing-reds.tsv"
git -C "$ROOT" add -A
set +e
OUT9="$(run_guard 2>&1)"
STATUS9=$?
set -e
git -C "$ROOT" reset -q --hard coder
[[ "$STATUS9" -ne 0 ]] || fail "09: expected refusal of a row whose owner declares no hotfix_fallback"
echo "$OUT9" | grep "newred9.test.js" >/dev/null || fail "09: refusal must name the row, got: $OUT9"
echo "$OUT9" | grep "hotfix_fallback" >/dev/null || fail "09: refusal must name the missing fallback, got: $OUT9"
pass "09: a new test-lane row whose owner declares no hotfix_fallback is refused, naming the row"

# ── 10: a new test-lane row whose owner declares multi-sitting without a
#    reason is refused (BL-1884) ──────────────────────────────────────────
git -C "$ROOT" checkout -q coder
cat > "$ROOT/backlog/paused/BL-5000-owner.yaml" <<'EOF'
id: BL-5000
hotfix_fallback: multi-sitting
EOF
printf 'unit\tnewred10.test.js\tBL-5000\t2026-10-01\tfixture\n' >> "$ROOT/backlog/standing-reds.tsv"
git -C "$ROOT" add -A
set +e
OUT10="$(run_guard 2>&1)"
STATUS10=$?
set -e
git -C "$ROOT" reset -q --hard coder
[[ "$STATUS10" -ne 0 ]] || fail "10: expected refusal of a multi-sitting declaration without a reason"
echo "$OUT10" | grep "newred10.test.js" >/dev/null || fail "10: refusal must name the row, got: $OUT10"
pass "10: a new test-lane row whose owner declares multi-sitting without a reason is refused"

# ── 11: a new test-lane row whose owner declares needs-ruling without
#    ruling_options is refused (BL-1884) ──────────────────────────────────
git -C "$ROOT" checkout -q coder
cat > "$ROOT/backlog/paused/BL-5000-owner.yaml" <<'EOF'
id: BL-5000
hotfix_fallback: needs-ruling
EOF
printf 'unit\tnewred11.test.js\tBL-5000\t2026-10-01\tfixture\n' >> "$ROOT/backlog/standing-reds.tsv"
git -C "$ROOT" add -A
set +e
OUT11="$(run_guard 2>&1)"
STATUS11=$?
set -e
git -C "$ROOT" reset -q --hard coder
[[ "$STATUS11" -ne 0 ]] || fail "11: expected refusal of a needs-ruling declaration without ruling_options"
echo "$OUT11" | grep "newred11.test.js" >/dev/null || fail "11: refusal must name the row, got: $OUT11"
pass "11: a new test-lane row whose owner declares needs-ruling without ruling_options is refused"

# ── 12: a hardening-lane row whose owner declares no hotfix_fallback
#    passes - hardening rows are not judged (BL-1884 scenario 04) ─────────
git -C "$ROOT" checkout -q coder
cat > "$ROOT/backlog/paused/BL-5000-owner.yaml" <<'EOF'
id: BL-5000
EOF
printf 'hardening\tnewred12.test.js\tBL-5000\t2026-10-01\tfixture\n' >> "$ROOT/backlog/standing-reds.tsv"
git -C "$ROOT" add -A
set +e
OUT12="$(run_guard 2>&1)"
STATUS12=$?
set -e
git -C "$ROOT" reset -q --hard coder
[[ "$STATUS12" -eq 0 ]] || fail "12: expected a hardening-lane row to pass even without a fallback declaration, got: $OUT12"
pass "12: a hardening-lane row whose owner declares no hotfix_fallback passes"

# ── 13: a new test-lane row whose owner declares needs-ruling with NO
#    ruling_options but DOES carry an unrelated bulleted field (invariants:)
#    is still refused - the bullet check must be scoped to the
#    ruling_options block, not any list in the file (architect bounce
#    2026-10-08) ──────────────────────────────────────────────────────────
git -C "$ROOT" checkout -q coder
cat > "$ROOT/backlog/paused/BL-5000-owner.yaml" <<'EOF'
id: BL-5000
hotfix_fallback: needs-ruling
invariants:
  - "some invariant unrelated to ruling_options"
  - "another invariant"
EOF
printf 'unit\tnewred13.test.js\tBL-5000\t2026-10-01\tfixture\n' >> "$ROOT/backlog/standing-reds.tsv"
git -C "$ROOT" add -A
set +e
OUT13="$(run_guard 2>&1)"
STATUS13=$?
set -e
git -C "$ROOT" reset -q --hard coder
[[ "$STATUS13" -ne 0 ]] || fail "13: expected refusal of a needs-ruling declaration with no ruling_options but an unrelated bullet list"
echo "$OUT13" | grep "newred13.test.js" >/dev/null || fail "13: refusal must name the row, got: $OUT13"
pass "13: a needs-ruling declaration with no ruling_options is refused even when the ticket carries an unrelated bullet list"

echo ""
echo "ALL PASS: check_standing_red_register.sh ledger join + merge-inherited-line filtering (BL-1646) + hotfix_fallback declaration (BL-1884)"
