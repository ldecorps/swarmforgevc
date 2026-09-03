#!/usr/bin/env bash
# BL-1378: an expedite-closed ticket can satisfy the close guard.
#
# The guard refuses an active->done commit unless QA sent the coordinator a
# handoff naming the ticket. An expedite run is forbidden by design from
# touching the mailboxes (BL-567), so it could never produce one and no ticket
# it finished could be committed to done by any route. This drives the REAL
# commit_integrity_cli.bb over real git fixtures - never the guard lib in
# isolation, because a decision that is right and not wired in refuses nothing.
#
# Ruling of 2026-09-03 (option 1, recorded in the ticket's human_ruling): the
# record is necessary but not sufficient - the approved commit must also have
# reached main.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../commit_integrity_cli.bb"

PREFIX="bl1378-expedite-close"
# BL-971: a killed run traps nothing, so sweep the prefix before this one too.
rm -rf "${TMPDIR:-/tmp}/${PREFIX}".* 2>/dev/null || true
TMPROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
trap 'rm -rf "$TMPROOT"' EXIT

fails=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; fails=$((fails + 1)); }
contains() { if grep -qF -- "$3" <<<"$2"; then pass "$1"; else fail "$1 (missing '$3')"; fi; }
absent()   { if grep -qF -- "$3" <<<"$2"; then fail "$1 (unexpectedly found '$3')"; else pass "$1"; fi; }

TICKET="BL-9001"

mk_fixture() {
  # mktemp, not a counter: a counter incremented inside `$( )` never reaches
  # the caller, so every fixture would be the same directory re-inited on top
  # of the last one.
  local root
  root="$(mktemp -d "$TMPROOT/fix.XXXXXX")"
  git -C "$root" init -q -b main
  git -C "$root" config user.email test@test
  git -C "$root" config user.name test
  git -C "$root" config commit.gpgsign false
  mkdir -p "$root/.swarmforge/handoffs/coordinator/inbox/new" "$root/backlog/active" "$root/backlog/done"
  printf "coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n" "$root" > "$root/.swarmforge/roles.tsv"
  printf 'id: %s\ntitle: x\nstatus: active\n' "$TICKET" > "$root/backlog/active/$TICKET-slug.yaml"
  git -C "$root" add -A
  git -C "$root" commit -q -m "seed active ticket"
  echo "$root"
}

# A commit that IS on main, and one that is not: the ancestry half of the
# ruling needs both to be real commits rather than invented shas.
landed_commit() { git -C "$1" rev-parse HEAD; }
unlanded_commit() {
  local root="$1"
  git -C "$root" checkout -q -b side
  git -C "$root" commit -q --allow-empty -m "work that never reached main"
  local sha; sha="$(git -C "$root" rev-parse HEAD)"
  git -C "$root" checkout -q main
  echo "$sha"
}

write_record() {
  local root="$1" ticket="$2" stage="$3" approval="$4" commit="$5"
  mkdir -p "$root/.swarmforge/expedite-approvals"
  printf '{"at":"2026-09-03T00:00:00Z","ticket":"%s","stage":"%s","approval":%s,"verdict":"pass","commit":"%s"}\n' \
    "$ticket" "$stage" "$approval" "$commit" \
    > "$root/.swarmforge/expedite-approvals/2026-09.jsonl"
}

write_qa_handoff() {
  printf 'id: x\nfrom: QA\nto: coordinator\npriority: 00\ntype: git_handoff\ntask: %s-slug\ncommit: a1b2c3d4e5\n\nbody\n' \
    "$TICKET" > "$1/.swarmforge/handoffs/coordinator/inbox/new/00_qa.handoff"
}

close_it() {
  local root="$1"
  # a failed `git mv` would leave the guard deciding about a move that never
  # happened, and every assertion below would then be about nothing.
  git -C "$root" mv "backlog/active/$TICKET-slug.yaml" "backlog/done/$TICKET-slug.yaml" \
    || { echo "fixture: git mv failed in $root"; return 99; }
  bb "$CLI" "$root" \
    --message "Close $TICKET: move to done" \
    --path "backlog/active/$TICKET-slug.yaml" \
    --path "backlog/done/$TICKET-slug.yaml" 2>&1
  return $?
}

# ═══════════════════════════════════════════════════════════════════════════
# 01: a record whose commit reached main allows the close
# ═══════════════════════════════════════════════════════════════════════════
echo "01: an expedite verdict record allows the close"
R="$(mk_fixture)"
# captured BEFORE the close, which makes its own commit and moves HEAD - the
# record names the commit that was approved, not whatever HEAD became.
APPROVED="$(landed_commit "$R")"
write_record "$R" "$TICKET" QA true "$APPROVED"
OUT="$(close_it "$R")"; STATUS=$?
if [[ $STATUS -eq 0 ]]; then pass "01: the close is allowed"; else fail "01: the close was refused: $OUT"; fi
contains "01: and the guard names the record it relied on" "$OUT" "expedite-qa-verdict"
contains "01: naming the approved commit" "$OUT" "$APPROVED"

# ═══════════════════════════════════════════════════════════════════════════
# 02: the mailbox path keeps deciding every close with no expedite record
# ═══════════════════════════════════════════════════════════════════════════
echo "02: the normal path is unchanged"
R2="$(mk_fixture)"
write_qa_handoff "$R2"
OUT2="$(close_it "$R2")"; STATUS2=$?
if [[ $STATUS2 -eq 0 ]]; then pass "02a: a QA handoff with no expedite record still closes"; else fail "02a: refused: $OUT2"; fi

R3="$(mk_fixture)"
OUT3="$(close_it "$R3")"; STATUS3=$?
if [[ $STATUS3 -ne 0 ]]; then pass "02b: no QA handoff and no record still refuses"; else fail "02b: allowed: $OUT3"; fi
contains "02b: with today's reason" "$OUT3" "missing-qa-approval"

# A store that cannot be read must NOT break a close the mailbox approved:
# an unrelated corrupt file taking the pipeline's own close route down would
# be worse than the defect this ticket fixes.
R4="$(mk_fixture)"
write_qa_handoff "$R4"
mkdir -p "$R4/.swarmforge/expedite-approvals"
printf 'not a record at all\n' > "$R4/.swarmforge/expedite-approvals/2026-09.jsonl"
OUT4="$(close_it "$R4")"; STATUS4=$?
if [[ $STATUS4 -eq 0 ]]; then pass "02c: a corrupt store does not break the mailbox path"; else fail "02c: refused: $OUT4"; fi

# ═══════════════════════════════════════════════════════════════════════════
# 03: a record grants a close only on ticket + QA stage + approval true
# ═══════════════════════════════════════════════════════════════════════════
echo "03: the record must match on all three"
for CASE in other-ticket other-stage approval-false; do
  RR="$(mk_fixture)"
  case "$CASE" in
    other-ticket)   write_record "$RR" "BL-9002" QA true "$(landed_commit "$RR")" ;;
    other-stage)    write_record "$RR" "$TICKET" coder true "$(landed_commit "$RR")" ;;
    approval-false) write_record "$RR" "$TICKET" QA false "$(landed_commit "$RR")" ;;
  esac
  OUTC="$(close_it "$RR")"; SC=$?
  if [[ $SC -ne 0 ]]; then pass "03 $CASE: the close is refused"; else fail "03 $CASE: allowed: $OUTC"; fi
  contains "03 $CASE: as a missing QA approval, not a store problem" "$OUTC" "missing-qa-approval"
done

# ═══════════════════════════════════════════════════════════════════════════
# 04: landed on main is also required (the human's ruling, option 1)
# ═══════════════════════════════════════════════════════════════════════════
echo "04: an approved commit that never reached main"
R5="$(mk_fixture)"
UNLANDED="$(unlanded_commit "$R5")"
write_record "$R5" "$TICKET" QA true "$UNLANDED"
OUT5="$(close_it "$R5")"; STATUS5=$?
if [[ $STATUS5 -ne 0 ]]; then pass "04: the close is refused"; else fail "04: allowed: $OUT5"; fi
contains "04: and the guard names the commit that never reached main" "$OUT5" "${UNLANDED:0:10}"
contains "04: saying what is wrong with it" "$OUT5" "not reached main"
contains "04: and where landing belongs" "$OUT5" "BL-247"

# ═══════════════════════════════════════════════════════════════════════════
# 05: a store that cannot be trusted refuses and says why
# ═══════════════════════════════════════════════════════════════════════════
echo "05: an unusable store"
R6="$(mk_fixture)"
printf 'a file where the directory should be\n' > "$R6/.swarmforge/expedite-approvals"
OUT6="$(close_it "$R6")"; S6=$?
if [[ $S6 -ne 0 ]]; then pass "05a obstructed: refused"; else fail "05a obstructed: allowed: $OUT6"; fi
contains "05a obstructed: and the problem is named" "$OUT6" "not a directory"

R7="$(mk_fixture)"
write_record "$R7" "$TICKET" QA true "$(landed_commit "$R7")"
chmod 000 "$R7/.swarmforge/expedite-approvals/2026-09.jsonl"
OUT7="$(close_it "$R7")"; S7=$?
chmod 644 "$R7/.swarmforge/expedite-approvals/2026-09.jsonl"
if [[ $S7 -ne 0 ]]; then pass "05b unreadable: refused"; else fail "05b unreadable: allowed: $OUT7"; fi
contains "05b unreadable: and the problem is named" "$OUT7" "unreadable"

R8="$(mk_fixture)"
mkdir -p "$R8/.swarmforge/expedite-approvals"
printf '{"ticket":"%s","stage":"QA","approval":true}\n' "$TICKET" > "$R8/.swarmforge/expedite-approvals/2026-09.jsonl"
OUT8="$(close_it "$R8")"; S8=$?
if [[ $S8 -ne 0 ]]; then pass "05c no commit field: refused"; else fail "05c no commit field: allowed: $OUT8"; fi
contains "05c no commit field: and the field is named" "$OUT8" "no commit field"

R9="$(mk_fixture)"
mkdir -p "$R9/.swarmforge/expedite-approvals"
printf '{"ticket":"%s","stage":"QA","commit":"%s"}\n' "$TICKET" "$(landed_commit "$R9")" \
  > "$R9/.swarmforge/expedite-approvals/2026-09.jsonl"
OUT9="$(close_it "$R9")"; S9=$?
if [[ $S9 -ne 0 ]]; then pass "05d no approval field: refused"; else fail "05d no approval field: allowed: $OUT9"; fi
contains "05d no approval field: and the field is named" "$OUT9" "no approval field"

# ═══════════════════════════════════════════════════════════════════════════
# 06: an absent store is not an approval, and not a store problem either
# ═══════════════════════════════════════════════════════════════════════════
echo "06: an absent store"
R10="$(mk_fixture)"
OUT10="$(close_it "$R10")"; S10=$?
if [[ $S10 -ne 0 ]]; then pass "06: the close is refused"; else fail "06: allowed: $OUT10"; fi
contains "06: reporting the missing QA approval" "$OUT10" "missing-qa-approval"
absent "06: and not a store problem" "$OUT10" "expedite-store-problem"

if [[ $fails -gt 0 ]]; then
  echo "test_bl1378_expedite_close_guard: $fails FAILURE(S)"
  exit 1
fi
echo "test_bl1378_expedite_close_guard: ALL PASS"
