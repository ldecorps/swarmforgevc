#!/usr/bin/env bash
# BL-1405: swarmforge/scripts/record_land_approval.bb over a REAL fixture
# repo, proving the hand-built tip-pure land route can reach the SAME
# writer land_step_cli.bb already calls (land_step_lib.bb's
# record-land-approval!), and that the shared predicate (is_qa_ancestor.sh)
# then answers approved for the replay it names - the whole point of the
# ticket: a hand-built land had no CLI reachable to call that writer at all.

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../record_land_approval.bb"
PREDICATE="$SCRIPT_DIR/../is_qa_ancestor.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

make_root() {
  local d
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  git -C "$d" -c user.email=t@t -c user.name=t init -q -b main
  git -C "$d" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
  printf '%s' "$d"
}

# ── 01/02: a fixture repo with an approved source and a hand-built replay
#    that is genuinely not an ancestor of swarmforge-QA ────────────────────
ROOT="$(make_root)"
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "approved parcel work"
SOURCE_SHA="$(git -C "$ROOT" rev-parse HEAD)"
git -C "$ROOT" branch swarmforge-QA
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "hand-built replay"
REPLAY_SHA="$(git -C "$ROOT" rev-parse HEAD)"

set +e
(cd "$ROOT" && bash "$PREDICATE" "$REPLAY_SHA" >/dev/null 2>&1)
BEFORE_EXIT=$?
set -e
[[ "$BEFORE_EXIT" -eq 1 ]] || fail "01: fixture is dishonest - the replay must NOT be approved before recording"
pass "01: the fixture's hand-built replay genuinely reads unapproved before recording"

set +e
OUT="$(bb "$CLI" "$ROOT" "$REPLAY_SHA" "$SOURCE_SHA" BL-9009 2>&1)"
ST=$?
set -e
[[ "$ST" -eq 0 ]] || fail "02: expected exit 0, got $ST: $OUT"
echo "$OUT" | grep -q "LAND_APPROVAL_RECORDED" || fail "02: expected LAND_APPROVAL_RECORDED, got: $OUT"
echo "$OUT" | grep -q "VERDICT ${REPLAY_SHA:0:10} approved" || fail "02: expected the printed verdict to say approved, got: $OUT"
STORE="$(cat "$ROOT"/.swarmforge/land-approvals/*.jsonl)"
echo "$STORE" | grep -q "\"commit\":\"${REPLAY_SHA:0:10}\"" || fail "02: record missing the replay commit: $STORE"
echo "$STORE" | grep -q "\"source\":\"${SOURCE_SHA:0:10}\"" || fail "02: record missing the approved source: $STORE"
echo "$STORE" | grep -q "\"ticket\":\"BL-9009\"" || fail "02: record missing the ticket id: $STORE"
set +e
(cd "$ROOT" && bash "$PREDICATE" "$REPLAY_SHA" >/dev/null 2>&1)
AFTER_EXIT=$?
set -e
[[ "$AFTER_EXIT" -eq 0 ]] || fail "02: the shared predicate must answer approved after recording"
pass "02: the CLI writes the SAME record the land step's own writer would, and the shared predicate then approves the replay"

# ── 03: omitting either sha refuses and writes nothing ─────────────────────
ROOT3="$(make_root)"
set +e
OUT3="$(bb "$CLI" "$ROOT3" "$REPLAY_SHA" 2>&1)"
ST3=$?
set -e
[[ "$ST3" -ne 0 ]] || fail "03a: expected non-zero when the source is omitted, got 0: $OUT3"
[[ ! -d "$ROOT3/.swarmforge/land-approvals" ]] || fail "03a: expected nothing written when the source is omitted"
set +e
OUT3b="$(bb "$CLI" "$ROOT3" "" "$SOURCE_SHA" 2>&1)"
ST3b=$?
set -e
[[ "$ST3b" -ne 0 ]] || fail "03b: expected non-zero when the commit is blank, got 0: $OUT3b"
[[ ! -d "$ROOT3/.swarmforge/land-approvals" ]] || fail "03b: expected nothing written when the commit is blank"
pass "03: omitting either sha refuses and writes nothing"

# ── 04: recording against an unapproved source is written, but the
#    predicate still says not approved ─────────────────────────────────────
ROOT4="$(make_root)"
git -C "$ROOT4" checkout -q -b other
git -C "$ROOT4" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "never reviewed"
UNAPPROVED_SHA="$(git -C "$ROOT4" rev-parse HEAD)"
git -C "$ROOT4" checkout -q main
git -C "$ROOT4" branch swarmforge-QA
git -C "$ROOT4" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "another hand-built replay"
REPLAY4_SHA="$(git -C "$ROOT4" rev-parse HEAD)"

set +e
OUT4="$(bb "$CLI" "$ROOT4" "$REPLAY4_SHA" "$UNAPPROVED_SHA" 2>&1)"
ST4=$?
set -e
[[ "$ST4" -eq 0 ]] || fail "04: expected the write itself to succeed even for an unapproved source, got $ST4: $OUT4"
echo "$OUT4" | grep -q "LAND_APPROVAL_RECORDED" || fail "04: expected a record to be written, got: $OUT4"
echo "$OUT4" | grep -q "VERDICT ${REPLAY4_SHA:0:10} not approved" || fail "04: expected the printed verdict to say not approved, got: $OUT4"
set +e
(cd "$ROOT4" && bash "$PREDICATE" "$REPLAY4_SHA" >/dev/null 2>&1)
ST4b=$?
set -e
[[ "$ST4b" -eq 1 ]] || fail "04: the shared predicate must still refuse - a record grants nothing on its own"
pass "04: a record naming an unapproved source is written, but the predicate still refuses (a record grants nothing on its own)"

# ── 05: running the CLI twice with the same arguments writes ONE line ──────
ROOT5="$(make_root)"
git -C "$ROOT5" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "approved parcel work"
SOURCE5_SHA="$(git -C "$ROOT5" rev-parse HEAD)"
git -C "$ROOT5" branch swarmforge-QA
git -C "$ROOT5" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "hand-built replay"
REPLAY5_SHA="$(git -C "$ROOT5" rev-parse HEAD)"
bb "$CLI" "$ROOT5" "$REPLAY5_SHA" "$SOURCE5_SHA" BL-9009 >/dev/null
OUT5b="$(bb "$CLI" "$ROOT5" "$REPLAY5_SHA" "$SOURCE5_SHA" BL-9009)"
echo "$OUT5b" | grep -q "LAND_APPROVAL_ALREADY_RECORDED" || fail "05: expected the second call to recognize the duplicate, got: $OUT5b"
LINES5="$(wc -l < "$ROOT5"/.swarmforge/land-approvals/*.jsonl | tr -d ' ')"
[[ "$LINES5" -eq 1 ]] || fail "05: expected exactly one line after two identical calls, got $LINES5"
pass "05: running the CLI twice with the same arguments writes exactly one line"

echo "ALL PASS"
