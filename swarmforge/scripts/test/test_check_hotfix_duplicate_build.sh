#!/usr/bin/env bash
# BL-1885: check_hotfix_duplicate_build.sh - refuses a hotfix commit whose
# stamp-off ticket has a build already in flight (a live mailbox parcel at
# a commit not on main, or an unlanded role-branch commit naming it),
# unless the message names every such build as superseded. Fixture
# repositories under mkdtemp (BL-1390), roles represented as subdirectories
# of one shared repo exactly like bl760DuplicateChainGuardSteps.js's own
# fixture shape (no real `git worktree add` needed - roles.tsv resolution
# only needs each worktree-path to exist).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$SCRIPT_DIR/../check_hotfix_duplicate_build.sh"
TICKET="BL-9001"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT=""
MSGDIR=""
cleanup() { [[ -n "$ROOT" ]] && rm -rf "$ROOT"; [[ -n "$MSGDIR" ]] && rm -rf "$MSGDIR"; }
trap cleanup EXIT

new_fixture() {
  ROOT="$(mktemp -d)"
  MSGDIR="$(mktemp -d)"
  git -C "$ROOT" init -q -b main
  git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  mkdir -p "$ROOT/.swarmforge" "$ROOT/coder-wt" "$ROOT/qa-wt"
  cat > "$ROOT/.swarmforge/roles.tsv" <<EOF
coder	coder-wt	$ROOT/coder-wt	swarmforge-coder	Coder	claude	task
QA	QA-wt	$ROOT/qa-wt	swarmforge-QA	Qa	claude	task
EOF
  mkdir -p "$ROOT/backlog/active"
  echo "id: $TICKET" > "$ROOT/backlog/active/$TICKET-fixture.yaml"
  git -C "$ROOT" add -A
  git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q -m "seed $TICKET"
}

# A live parcel for $TICKET in a role's mailbox, at a commit NOT on main
# (an orphan commit on a throwaway branch, never merged).
seed_mailbox_blocker() {
  local role_dir="$1" state="$2"
  local sha
  git -C "$ROOT" checkout -q -b orphan-work
  echo x > "$ROOT/scratch.txt"
  git -C "$ROOT" add -A
  git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q -m "$TICKET: unlanded build"
  sha="$(git -C "$ROOT" rev-parse HEAD)"
  git -C "$ROOT" checkout -q main
  local dir="$role_dir/.swarmforge/handoffs/inbox/$state"
  mkdir -p "$dir"
  cat > "$dir/10_blocker.handoff" <<EOF
id: x
from: coder
to: QA
priority: 50
type: git_handoff
task: $TICKET
commit: $sha
created_at: 2026-07-31T00:00:00Z

body
EOF
  printf '%s\n' "$sha"
}

# A commit naming $TICKET on a role's own branch (session column), not
# merged to main.
seed_branch_blocker() {
  local branch="$1"
  local sha
  git -C "$ROOT" checkout -q -b "$branch"
  echo y > "$ROOT/scratch2.txt"
  git -C "$ROOT" add -A
  git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q -m "$TICKET: a role-branch build"
  sha="$(git -C "$ROOT" rev-parse HEAD)"
  git -C "$ROOT" checkout -q main
  printf '%s\n' "$sha"
}

write_msg() {
  local file="$1"; shift
  printf '%s\n' "$@" > "$file"
}

run_guard() {
  (cd "$ROOT" && bash "$GUARD" "$@")
}

# ── 01: a live mailbox parcel at an unlanded commit refuses the hotfix ───
new_fixture
SHA="$(seed_mailbox_blocker "$ROOT/qa-wt" new)"
MSG="$MSGDIR/01.txt"
write_msg "$MSG" "Hotfix: fix something" "" "By specifier." "" "Hotfix-Certification: pending" "Stamp-off: $TICKET"
set +e
OUT="$(run_guard "$MSG" 2>&1)"; RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "01: expected refusal for a live-parcel blocker"
grep -q "$TICKET" <<<"$OUT" || fail "01: refusal must name $TICKET, got: $OUT"
grep -q "QA" <<<"$OUT" || fail "01: refusal must name the blocking role, got: $OUT"
grep -q "${SHA:0:10}" <<<"$OUT" || fail "01: refusal must name the blocking commit, got: $OUT"
pass "01: a live mailbox parcel at an unlanded commit refuses the hotfix"

# ── 02: an unlanded role-branch commit refuses the hotfix ───────────────
new_fixture
SHA="$(seed_branch_blocker "swarmforge-coder")"
MSG="$MSGDIR/02.txt"
write_msg "$MSG" "Hotfix: fix something" "" "By specifier." "" "Hotfix-Certification: pending" "Stamp-off: $TICKET"
set +e
OUT="$(run_guard "$MSG" 2>&1)"; RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "02: expected refusal for an unlanded role-branch build"
grep -q "${SHA:0:10}" <<<"$OUT" || fail "02: refusal must name the unlanded commit, got: $OUT"
pass "02: an unlanded role-branch commit refuses the hotfix"

# ── 03: naming the in-flight build as superseded lets the hotfix land ───
new_fixture
SHA="$(seed_mailbox_blocker "$ROOT/qa-wt" new)"
MSG="$MSGDIR/03.txt"
write_msg "$MSG" "Hotfix: fix something" "" "By specifier." "" "Hotfix-Certification: pending" "Stamp-off: $TICKET" "Supersedes-Build: $SHA"
run_guard "$MSG" || fail "03: expected the hotfix to be accepted once the build is named superseded"
pass "03: naming the in-flight build as superseded lets the hotfix land"

# ── 04: nothing in flight lets the hotfix land ───────────────────────────
new_fixture
MSG="$MSGDIR/04.txt"
write_msg "$MSG" "Hotfix: fix something" "" "By specifier." "" "Hotfix-Certification: pending" "Stamp-off: $TICKET"
run_guard "$MSG" || fail "04: expected the hotfix to be accepted with nothing in flight"
pass "04: nothing in flight lets the hotfix land"

# ── 05: a non-hotfix commit, or a hotfix with no Stamp-off: line, is never checked ──
new_fixture
SHA="$(seed_mailbox_blocker "$ROOT/qa-wt" new)"
MSG="$MSGDIR/05a.txt"
write_msg "$MSG" "tidy up whitespace"
run_guard "$MSG" || fail "05a: expected a plain commit to be unaffected by a live blocker elsewhere"
MSG2="$MSGDIR/05b.txt"
write_msg "$MSG2" "Hotfix: fix something" "" "By specifier." "" "Hotfix-Certification: pending"
run_guard "$MSG2" || fail "05b: expected a hotfix with no Stamp-off: line to be unaffected"
pass "05: a non-hotfix commit, or a hotfix with no Stamp-off: line, is never checked"

echo "BL-1885 check_hotfix_duplicate_build: ALL PASS"
