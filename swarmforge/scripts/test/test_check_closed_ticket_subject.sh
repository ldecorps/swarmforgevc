#!/usr/bin/env bash
# BL-1617: the commit-msg guard that refuses a role-branch commit whose
# subject the land step's own subject-attribution would read as owned by a
# closed ticket, an unknown one, or ambiguously by several with none
# leading. Fixture repositories under mkdtemp with a fake
# refs/remotes/origin/main (BL-1390).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GUARD="$SCRIPT_DIR/../check_closed_ticket_subject.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT=""
MSGDIR=""
cleanup() { [[ -n "$ROOT" ]] && rm -rf "$ROOT"; [[ -n "$MSGDIR" ]] && rm -rf "$MSGDIR"; }
trap cleanup EXIT

new_fixture() {
  ROOT="$(mktemp -d)"
  MSGDIR="$(mktemp -d)"
  git -C "$ROOT" init -q -b work
  git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
}

# A ticket file under the given folder on origin/main (committed on a
# throwaway ref, then pointed at by refs/remotes/origin/main - never a real
# remote, matching the repo's own mkdtemp-fixture posture).
seed_origin_ticket() {
  local id="$1" folder="$2"
  mkdir -p "$ROOT/backlog/$folder"
  echo "id: $id" > "$ROOT/backlog/$folder/$id-fixture.yaml"
  git -C "$ROOT" add -A
  git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q -m "seed $id under $folder"
}

mark_origin_main() {
  git -C "$ROOT" update-ref refs/remotes/origin/main HEAD
}

write_msg() {
  local file="$1" subject="$2"
  printf '%s\n' "$subject" > "$file"
}

run_guard() {
  (cd "$ROOT" && bash "$GUARD" "$@")
}

# ── 01: a subject leading with a ticket closed (done-only) on origin/main
#        is refused, naming the closed ticket ─────────────────────────────
new_fixture
seed_origin_ticket "BL-9601" "done"
mark_origin_main
MSG="$MSGDIR/01.txt"; write_msg "$MSG" "BL-9601: probe"
set +e
OUT="$(run_guard "$MSG" 2>&1)"; RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "01: expected refusal for a closed-ticket-leading subject"
echo "$OUT" | grep -q "BL-9601" || fail "01: refusal must name the closed ticket, got: $OUT"
echo "$OUT" | grep -qi "closed" || fail "01: refusal must say why (closed), got: $OUT"
pass "01: a subject leading with a closed ticket is refused, naming it"

# ── 02: a subject leading with an open ticket commits ──────────────────────
new_fixture
seed_origin_ticket "BL-9602" "active"
mark_origin_main
MSG="$MSGDIR/02.txt"; write_msg "$MSG" "BL-9602: probe"
run_guard "$MSG" || fail "02: expected an open-ticket-leading subject to commit"
pass "02: a subject leading with an open ticket commits"

# ── 03: an untagged subject commits ─────────────────────────────────────────
new_fixture
seed_origin_ticket "BL-9603" "done"
mark_origin_main
MSG="$MSGDIR/03.txt"; write_msg "$MSG" "tidy up whitespace"
run_guard "$MSG" || fail "03: expected an untagged subject to commit"
pass "03: an untagged subject commits"

# ── 04: the same closed-ticket subject, on branch main, commits (silent on
#        main - bookkeeping/land commits legitimately name closing tickets) ─
new_fixture
seed_origin_ticket "BL-9604" "done"
mark_origin_main
git -C "$ROOT" branch -m main
MSG="$MSGDIR/04.txt"; write_msg "$MSG" "BL-9604: probe"
run_guard "$MSG" || fail "04: expected the guard silent on branch main"
pass "04: the same closed-ticket subject on branch main commits"

# ── 05: an unreadable origin/main warns and commits ─────────────────────────
new_fixture
# refs/remotes/origin/main deliberately never created - ls-tree will fail.
MSG="$MSGDIR/05.txt"; write_msg "$MSG" "BL-9605: probe"
set +e
OUT="$(run_guard "$MSG" 2>&1)"; RC=$?
set -e
[[ "$RC" -eq 0 ]] || fail "05: expected an unreadable origin/main to fail OPEN, got rc=$RC: $OUT"
echo "$OUT" | grep -qi "warning" || fail "05: expected a warning naming the unreadable origin/main, got: $OUT"
pass "05: an unreadable origin/main warns and commits"

# ── 06: a subject naming two ids with neither leading is refused as
#        ambiguous, naming every id ─────────────────────────────────────────
new_fixture
seed_origin_ticket "BL-9606" "active"
seed_origin_ticket "BL-9607" "done"
mark_origin_main
MSG="$MSGDIR/06.txt"; write_msg "$MSG" "Revert x's BL-9606/BL-9607 row"
set +e
OUT="$(run_guard "$MSG" 2>&1)"; RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "06: expected refusal for an ambiguous subject"
echo "$OUT" | grep -q "BL-9606" || fail "06: refusal must name BL-9606, got: $OUT"
echo "$OUT" | grep -q "BL-9607" || fail "06: refusal must name BL-9607, got: $OUT"
echo "$OUT" | grep -qi "ambiguous" || fail "06: refusal must say ambiguous, got: $OUT"
pass "06: a subject naming several ids with none leading is refused as ambiguous"

# ── 07: a leading id with no ticket file anywhere on origin/main is refused
#        as unknown there ──────────────────────────────────────────────────
new_fixture
mark_origin_main
MSG="$MSGDIR/07.txt"; write_msg "$MSG" "BL-9608: probe"
set +e
OUT="$(run_guard "$MSG" 2>&1)"; RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "07: expected refusal for a leading id with no ticket file anywhere"
echo "$OUT" | grep -q "BL-9608" || fail "07: refusal must name BL-9608, got: $OUT"
echo "$OUT" | grep -qi "no ticket file" || fail "07: refusal must say no ticket file, got: $OUT"
pass "07: a leading id with no ticket file anywhere on origin/main is refused as unknown"

# ── 08: a verb-prefixed leading subject (close/promote/approve, any case)
#        is read the same way as a bare leading id ─────────────────────────
new_fixture
seed_origin_ticket "BL-9609" "done"
mark_origin_main
MSG="$MSGDIR/08.txt"; write_msg "$MSG" "Close BL-9609: move to done"
set +e
OUT="$(run_guard "$MSG" 2>&1)"; RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "08: expected refusal for a verb-prefixed closed-leading subject"
echo "$OUT" | grep -q "BL-9609" || fail "08: refusal must name BL-9609, got: $OUT"
pass "08: a verb-prefixed leading subject is read the same as a bare leading id"

# ── 09: no message-file argument defers (pre-commit-time semantics) ────────
new_fixture
seed_origin_ticket "BL-9610" "done"
mark_origin_main
run_guard || fail "09: with no message-file argument, the guard must defer (exit 0)"
pass "09: no message-file argument defers"

# ── 10 (BL-897): the two mirrored regex literals agree with their bb
#        originals, across the language boundary ───────────────────────────
BB_PREFIXES="$(grep -oE '\["[A-Z]+" "[A-Z]+"\]' "$REPO_ROOT/swarmforge/scripts/pipeline_stage_lib.bb" | head -1 | grep -oE '[A-Z]+' | tr '\n' '|' | sed 's/|$//')"
[[ "$BB_PREFIXES" == "BL|GH" ]] || fail "10: expected pipeline_stage_lib.bb's known-ticket-prefixes to read BL|GH, got: $BB_PREFIXES (re-check the guard's own TICKET_PREFIXES if this ever moves)"
grep -q 'TICKET_PREFIXES="BL|GH"' "$GUARD" || fail "10: the guard's TICKET_PREFIXES must mirror pipeline_stage_lib.bb's known-ticket-prefixes (BL|GH)"

BB_VERBS="$(grep -oE '\["close" "promote" "approve"\]' "$REPO_ROOT/swarmforge/scripts/land_step_lib.bb" | head -1)"
[[ -n "$BB_VERBS" ]] || fail "10: expected land_step_lib.bb's leading-verb-prefixes to read [\"close\" \"promote\" \"approve\"] verbatim (re-check the guard's own verb list if this ever moves)"
grep -q '\[Cc\]\[Ll\]\[Oo\]\[Ss\]\[Ee\].*\[Pp\]\[Rr\]\[Oo\]\[Mm\]\[Oo\]\[Tt\]\[Ee\].*\[Aa\]\[Pp\]\[Pp\]\[Rr\]\[Oo\]\[Vv\]\[Ee\]' "$GUARD" \
  || fail "10: the guard's leading-verb match must mirror land_step_lib.bb's leading-verb-prefixes (close, promote, approve)"
pass "10: the guard's mirrored regex literals agree with their bb originals (BL-897)"

echo "ALL PASS"
