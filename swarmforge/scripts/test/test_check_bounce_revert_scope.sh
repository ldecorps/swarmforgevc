#!/usr/bin/env bash
# BL-1471: a bounce revert must touch only the bounced ticket's own paths,
# and an omission-class bounce must revert nothing at all - see
# swarmforge/scripts/check_bounce_revert_scope.sh's own header for the
# 2026-09-07 BL-1348 incident this guards against.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$SCRIPT_DIR/../check_bounce_revert_scope.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
MSGDIR="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT" "$MSGDIR"' EXIT
MSG="$MSGDIR/msg.txt"

run_guard() {
  (cd "$ROOT" && bash "$GUARD" "$@")
}

record_bounce() {
  # record_bounce <ticket> <class> <commit> <at>
  local dir="$ROOT/.swarmforge/bounces"
  mkdir -p "$dir"
  printf '{"ticket":"%s","producingRole":"coder","ticketType":"defect","failureClass":"%s","commit":"%s","by":"QA","at":"%s"}\n' \
    "$1" "$2" "$3" "$4" >> "$dir/2026-09.jsonl"
}

revert_message() {
  # revert_message <original-subject> <reverted-full-sha>
  printf 'Revert "%s"\n\nThis reverts commit %s.\n' "$1" "$2"
}

git -C "$ROOT" init -q -b main
git -C "$ROOT" config user.email test@test
git -C "$ROOT" config user.name test
git -C "$ROOT" config commit.gpgsign false
git -C "$ROOT" commit -q --allow-empty -m seed
BASE_TIP="$(git -C "$ROOT" rev-parse HEAD)"

# ── fixture builder: a "documenter" branch carrying one or two tickets'
#    commits, merged into "main" (standing in for QA's reviewing branch)
#    with a subject naming no ticket - the exact shape check_merge_deletion
#    itself already exercises, reused here because a bounce revert reverses
#    exactly this kind of merge. ─────────────────────────────────────────
build_merge() {
  # build_merge <branch-suffix> <one|two>
  local suffix="$1" tickets="$2"
  git -C "$ROOT" checkout -q -b "doc$suffix" "$BASE_TIP"
  mkdir -p "$ROOT/specs/pipeline/steps"
  echo "step handler" > "$ROOT/specs/pipeline/steps/bl0001Example${suffix}Steps.js"
  git -C "$ROOT" add "specs/pipeline/steps/bl0001Example${suffix}Steps.js"
  git -C "$ROOT" commit -q -m "BL-0001: add step handler"
  # The bounced ticket's OWN commit - what a real bounce record's `commit`
  # field names (the parcel commit QA reviewed), never a placeholder: the
  # guard's ticket-identification matches this against the merge's second
  # parent by ancestry, not by guessing off commit subjects.
  BL0001_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
  if [[ "$tickets" == "two" ]]; then
    echo "step handler 2" > "$ROOT/specs/pipeline/steps/bl0002Example${suffix}Steps.js"
    git -C "$ROOT" add "specs/pipeline/steps/bl0002Example${suffix}Steps.js"
    git -C "$ROOT" commit -q -m "BL-0002: add a second step handler"
  fi
  DOC_TIP="$(git -C "$ROOT" rev-parse HEAD)"
  git -C "$ROOT" checkout -q main
  git -C "$ROOT" reset -q --hard "$BASE_TIP"
  git -C "$ROOT" merge -q --no-ff -m "Merge documenter $DOC_TIP into QA." "doc$suffix"
  MERGE_TIP="$(git -C "$ROOT" rev-parse HEAD)"
}

stage_revert() {
  # stage_revert - leaves the revert of MERGE_TIP staged (uncommitted) and
  # writes its message to $MSG.
  git -C "$ROOT" revert -n -m 1 "$MERGE_TIP"
  revert_message "Merge documenter $DOC_TIP into QA." "$MERGE_TIP" > "$MSG"
}

reset_after_revert() {
  git -C "$ROOT" checkout -q main
  git -C "$ROOT" reset -q --hard "$MERGE_TIP"
}

# ── 1: a wrong-content bounce, revert touches only the bounced ticket's
#       own path - passes ─────────────────────────────────────────────────
build_merge "a" "one"
record_bounce "BL-0001" "behavior" "$BL0001_COMMIT" "2026-09-07T10:00:00.000Z"
stage_revert
run_guard "$MSG" || fail "01: a scoped revert of a wrong-content bounce must pass"
pass "01: a revert whose diff touches only the bounced ticket's own paths passes"
reset_after_revert

# ── 2: a wrong-content bounce, revert also removes a DIFFERENT ticket's
#       path - refused, naming the path and its ticket ───────────────────
build_merge "b" "two"
record_bounce "BL-0001" "behavior" "$BL0001_COMMIT" "2026-09-07T11:00:00.000Z"
stage_revert
set +e
OUT2="$(run_guard "$MSG" 2>&1)"
STATUS2=$?
set -e
[[ "$STATUS2" -ne 0 ]] || fail "02: expected refusal when the revert also removes another ticket's path"
echo "$OUT2" | grep -q "bl0002ExamplebSteps.js" || fail "02: refusal must name the other ticket's path, got: $OUT2"
echo "$OUT2" | grep -q "BL-0002" || fail "02: refusal must name the other ticket BL-0002, got: $OUT2"
pass "02: a revert that removes a path attributed to another ticket is refused, naming the path and the ticket"
reset_after_revert

# ── 3: an omission-class bounce - refused as having nothing to revert,
#      regardless of how scoped the diff itself is ────────────────────────
for class in spec-gap invariant-unencoded; do
  build_merge "c-$class" "one"
  record_bounce "BL-0001" "$class" "$BL0001_COMMIT" "2026-09-07T12:00:00.000Z"
  stage_revert
  set +e
  OUT3="$(run_guard "$MSG" 2>&1)"
  STATUS3=$?
  set -e
  [[ "$STATUS3" -ne 0 ]] || fail "03 ($class): expected refusal for an omission-class bounce"
  echo "$OUT3" | grep -qi "nothing to revert" || fail "03 ($class): refusal must say an omission bounce reverts nothing, got: $OUT3"
  pass "03 ($class): a revert made for an omission-class bounce is refused as having nothing to revert"
  reset_after_revert
done

# ── 4: an ordinary (non-revert) commit is never judged by this guard ──────
echo "unrelated change" > "$ROOT/unrelated.txt"
git -C "$ROOT" add unrelated.txt
echo "chore: an ordinary commit" > "$MSG"
run_guard "$MSG" || fail "04: an ordinary commit must never be refused by this guard"
pass "04: a commit that is not a revert is not judged by the guard"
git -C "$ROOT" reset -q --hard HEAD
rm -f "$ROOT/unrelated.txt"

# ── 5: with no message-file argument (the pre-commit chain's own call),
#      the guard always defers, even mid-revert with an omission bounce on
#      file - the message does not exist yet at pre-commit time. ─────────
build_merge "e" "one"
record_bounce "BL-0001" "spec-gap" "$BL0001_COMMIT" "2026-09-07T13:00:00.000Z"
git -C "$ROOT" revert -n -m 1 "$MERGE_TIP"
run_guard || fail "05: with no message-file argument the guard must always defer (exit 0)"
pass "05: called with no message-file argument (pre-commit time), the guard always defers"
reset_after_revert

# ── 6: ticket identification is by the bounce record's own commit being an
#      ANCESTOR of the merge's second parent, never by guessing off commit
#      subjects - an untagged subject ("chore: ...", no ticket id at all)
#      still resolves correctly because the bounce record's commit is
#      itself the ticket's own commit. ─────────────────────────────────────
git -C "$ROOT" checkout -q -b docf "$BASE_TIP"
mkdir -p "$ROOT/specs/pipeline/steps"
echo "step handler" > "$ROOT/specs/pipeline/steps/bl0001ExamplefSteps.js"
git -C "$ROOT" add specs/pipeline/steps/bl0001ExamplefSteps.js
git -C "$ROOT" commit -q -m "chore: untagged commit, no ticket id"
DOCF_TICKET_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
DOCF_TIP="$DOCF_TICKET_COMMIT"
git -C "$ROOT" checkout -q main
git -C "$ROOT" reset -q --hard "$BASE_TIP"
git -C "$ROOT" merge -q --no-ff -m "Merge documenter $DOCF_TIP into QA." docf
MERGEF_TIP="$(git -C "$ROOT" rev-parse HEAD)"
record_bounce "BL-0001" "behavior" "$DOCF_TICKET_COMMIT" "2026-09-07T14:00:00.000Z"
git -C "$ROOT" revert -n -m 1 "$MERGEF_TIP"
revert_message "Merge documenter $DOCF_TIP into QA." "$MERGEF_TIP" > "$MSG"
run_guard "$MSG" || fail "06: fallback ticket identification (untagged merge history) must still pass a scoped revert"
pass "06: an untagged second-parent history falls back to the bounce store's own latest ticket"
git -C "$ROOT" checkout -q main
git -C "$ROOT" reset -q --hard "$MERGEF_TIP"

echo "ALL PASS"
