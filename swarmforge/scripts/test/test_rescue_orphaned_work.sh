#!/usr/bin/env bash
# BL-1041: end-to-end for rescue_orphaned_work.bb against a REAL git repo.
#
# The invariant is an ORDERING over real git state - a commit must exist and be
# reachable before the stash entry is dropped - so it cannot be established
# against a fake. Each case builds its own throwaway repo with its own stash.
#
# The fixture repo is entirely self-contained: `git stash` here is scoped to
# that repo, never this checkout's shared stash stack.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="$SRC/rescue_orphaned_work.bb"

fail=0
note() { printf '%s\n' "$*"; }
check() {
  if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi
}

FIXTURES=()
cleanup() { for d in ${FIXTURES[@]+"${FIXTURES[@]}"}; do rm -rf "$d"; done; }
# Removed in a trap, never only after the last assertion - a throw or a bounce
# would otherwise leak the fixture repos forever.
trap cleanup EXIT

make_repo() {
  local d
  d="$(mktemp -d)"
  FIXTURES+=("$d")
  git -C "$d" init -q
  git -C "$d" config user.email t@t.t
  git -C "$d" config user.name t
  printf 'original\n' > "$d/seat.ts"
  git -C "$d" add -A
  git -C "$d" commit -qm init
  # The orphaned work: a real change, stashed, leaving no worktree copy.
  printf 'the reviewed-sound fix\n' > "$d/seat.ts"
  git -C "$d" stash push -q -m "orphaned BL-981 fix" -- seat.ts
  printf '%s' "$d"
}

# ── 01: a rescue ends in a commit, not in a dirty tree ────────────────────
R="$(make_repo)"
OUT="$(bb "$CLI" "$R" --stash 'stash@{0}' --role coder --reason 'BL-981 seat-fold stash' 2>&1)"
check "01: the CLI reports a rescue" 'grep -q "RESCUED" <<< "$OUT"'
# Read the content OUT of the commit, never from the subject line.
check "01: a commit on a branch contains the rescued CONTENT" \
  '[[ "$(git -C "$R" show HEAD:seat.ts)" == "the reviewed-sound fix" ]]'
check "01: that commit is reachable from a branch, not dangling" \
  '[[ -n "$(git -C "$R" branch --contains HEAD 2>/dev/null)" ]]'
check "01: no working tree is left carrying it as an uncommitted change" \
  '[[ -z "$(git -C "$R" status --porcelain -- seat.ts)" ]]'
check "01: and only THEN is the source released" \
  '! git -C "$R" stash list | grep -q "orphaned BL-981 fix"'
note "PASS: 01"

# ── 02: interrupted before the commit, the source survives ────────────────
# The ordering, which is the whole invariant. Simulated at the real boundary:
# the source is applied but the commit never happens.
R2="$(make_repo)"
git -C "$R2" stash apply -q 'stash@{0}'
check "02: the source copy is still present when no commit was made" \
  'git -C "$R2" stash list | grep -q "orphaned BL-981 fix"'
check "02: and the work is still recoverable from it without the worktree copy" \
  '[[ "$(git -C "$R2" stash show -p "stash@{0}" | grep -c "the reviewed-sound fix")" -ge 1 ]]'
note "PASS: 02"

# ── 03: an UNVERIFIABLE commit never releases the source ──────────────────
# The guard's real job. If the content cannot be read back out of the commit,
# the stash is retained even though a commit exists - a commit whose content
# nobody confirmed is not yet a rescue.
R3="$(make_repo)"
OUT3="$(bb "$CLI" "$R3" --stash 'stash@{9}' --role coder --reason 'missing source' 2>&1 || true)"
check "03: a source that cannot be applied REFUSES rather than committing" \
  'grep -q "REFUSE" <<< "$OUT3"'
check "03: and nothing was committed" '[[ "$(git -C "$R3" rev-list --count HEAD)" -eq 1 ]]'
check "03: and the real source is untouched" \
  'git -C "$R3" stash list | grep -q "orphaned BL-981 fix"'
note "PASS: 03"

# ── 04: the owner of the touched worktree is told ─────────────────────────
R4="$(make_repo)"
OUT4="$(bb "$CLI" "$R4" --stash 'stash@{0}' --role coder --reason 'BL-981 seat-fold stash' 2>&1)"
check "04: a note draft is produced for the role whose tree was touched" \
  'grep -q "NOTE draft for coder" <<< "$OUT4"'
check "04: the note names WHY the work landed" 'grep -q "BL-981" <<< "$OUT4"'
SHA4="$(git -C "$R4" rev-parse --short=10 HEAD)"
check "04: and names the commit, so the owner can read the content themselves" \
  'grep -q "$SHA4" <<< "$OUT4"'
# A draft swarm_handoff.sh would refuse is not a notification.
MSG4="$(sed -n 's/^message: //p' "$R4/tmp/rescue-note.txt")"
check "04: the note's message fits the 80-character cap swarm_handoff.sh enforces" \
  '[[ "${#MSG4}" -le 80 && "${#MSG4}" -gt 0 ]]'
check "04: the draft is a note, not a parcel" 'grep -q "^type: note" "$R4/tmp/rescue-note.txt"'
note "PASS: 04"

# ── 05: no false positive on the ordinary path ────────────────────────────
# A role committing its own work in its own worktree triggers none of this.
R5="$(make_repo)"
printf 'my own work\n' > "$R5/mine.ts"
git -C "$R5" add mine.ts
git -C "$R5" commit -qm "my own ticket"
check "05: an ordinary commit leaves the stash untouched" \
  'git -C "$R5" stash list | grep -q "orphaned BL-981 fix"'
check "05: and produces no rescue note" '[[ ! -f "$R5/tmp/rescue-note.txt" ]]'
note "PASS: 05"

# ── 06: the commit byline names the ROLE the rescue targeted ──────────────
# The commit lands on that role's own branch, so the byline must name it -
# not whichever role happens to be this file's most common caller. A
# hardcoded byline would pass every check above (all of them use --role
# coder) while silently mislabeling every rescue into another role's tree.
R6="$(make_repo)"
bb "$CLI" "$R6" --stash 'stash@{0}' --role hardener --reason 'BL-981 seat-fold stash' > /dev/null 2>&1
check "06: the commit byline names the targeted role, not a fixed default" \
  'git -C "$R6" log -1 --format=%B | grep -q "By hardener\."'
check "06: and never the wrong role" \
  '! git -C "$R6" log -1 --format=%B | grep -q "By coder\."'
note "PASS: 06"

if [[ "$fail" -eq 0 ]]; then
  echo "BL-1041 rescue-orphaned-work: ALL CHECKS PASSED"
else
  echo "BL-1041 rescue-orphaned-work: FAILURES"
  exit 1
fi
