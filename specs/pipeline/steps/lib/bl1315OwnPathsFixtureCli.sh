#!/usr/bin/env bash
# BL-1315 acceptance driver: the REAL land_step_cli.bb over a REAL repository
# with a REAL bare origin, in each shape the ticket's own-paths fix has to
# handle - both the over-inclusion face (a sibling's unlanded content must
# not enter the tip) and the under-inclusion face (the landed ticket's own
# content must survive even when it reached the branch before its own
# tagged merge did).
#
# Usage: bl1315OwnPathsFixtureCli.sh <work-dir> <shape>
#   shape: sibling-unlanded | sibling-landed | sibling-byte-identical |
#          multi-role | unreadable-attribution | no-sibling | earlier-merge
# Prints one JSON line:
#   {"exit":N,"action":str,"citedCommit":str,"replayCommit":str,
#    "addedPaths":[...],"fullDeliveredPaths":[...],"reason":str,"out":str}
#
# addedPaths: the REPLAY tip's own diff against origin/main (empty unless
# action is LAND_REPLAY). fullDeliveredPaths: the cited commit's own diff
# against origin/main - the ceiling every scenario measures the tip against.
set -uo pipefail

WORK="$1"
SHAPE="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
CLI="$REPO_ROOT/swarmforge/scripts/land_step_cli.bb"

ORIGIN="$WORK/origin.git"
R="$WORK/repo"

git init -q --bare -b main "$ORIGIN"
git init -q -b main "$R"
git -C "$R" config user.email t@t
git -C "$R" config user.name t
git -C "$R" config commit.gpgsign false
git -C "$R" remote add origin "$ORIGIN"

echo base > "$R/base.txt"
git -C "$R" add -A
git -C "$R" commit -q -m "seed the fixture"
git -C "$R" push -q origin main

land_on_origin() {
  # Lands `paths` on origin/main as a DIFFERENT commit object, exactly as a
  # tip-pure replay does - never by fast-forwarding the fixture's own repo.
  local tmp="$WORK/lander"
  git clone -q "$ORIGIN" "$tmp"
  git -C "$tmp" config user.email t@t
  git -C "$tmp" config user.name t
  git -C "$tmp" config commit.gpgsign false
  for f in "$@"; do cp "$R/$f" "$tmp/$f"; done
  git -C "$tmp" add -A
  git -C "$tmp" commit -q -m "BL-9002: sibling work (replayed tip-pure)."
  git -C "$tmp" push -q origin main
  git -C "$R" fetch -q origin
}

CITED=""
UNREADABLE_OBJECT=""

case "$SHAPE" in
  sibling-unlanded|sibling-landed|sibling-byte-identical|unreadable-attribution)
    if [ "$SHAPE" = sibling-byte-identical ]; then
      printf 'same content\n' > "$R/shared.txt"
      git -C "$R" add -A
      git -C "$R" commit -q -m "seed the shared file"
      git -C "$R" push -q origin main
    fi
    git -C "$R" checkout -q -b bl1315-sibling
    if [ "$SHAPE" = sibling-byte-identical ]; then
      printf 'same content\n' > "$R/shared.txt"
    else
      printf 'sibling a\n' > "$R/sib_a.txt"
    fi
    git -C "$R" add -A
    git -C "$R" commit -q --allow-empty -m "BL-9002: sibling unlanded work."
    SIBLING="$(git -C "$R" rev-parse HEAD)"
    git -C "$R" checkout -q main
    echo own > "$R/own.txt"
    git -C "$R" add -A
    git -C "$R" commit -q -m "BL-9001: own work."
    git -C "$R" merge --no-ff -q -m "BL-9001: forward merge" bl1315-sibling
    CITED="$(git -C "$R" rev-parse HEAD)"
    if [ "$SHAPE" = sibling-landed ]; then
      land_on_origin sib_a.txt
    fi
    if [ "$SHAPE" = unreadable-attribution ]; then
      # Delete the sibling's own TREE object, not its commit - so the full
      # ancestry walk (commit headers only) and the endpoint-to-endpoint
      # diff (needs only the two TIP trees) both still succeed, and only
      # the per-path attribution walk for the sibling's own path (which
      # must read the sibling's tree to diff it) fails. Isolates the
      # refusal to own-paths itself, distinct from BL-1308's own
      # unreadable-ANCESTRY scenario one door up.
      UNREADABLE_OBJECT="$(git -C "$R" rev-parse "$SIBLING^{tree}")"
      rm -f "$R/.git/objects/${UNREADABLE_OBJECT:0:2}/${UNREADABLE_OBJECT:2}"
    fi
    ;;
  multi-role)
    echo coder > "$R/coder.txt"
    git -C "$R" add -A
    git -C "$R" commit -q -m "coder: implement the feature"
    echo hardened > "$R/hardener.txt"
    git -C "$R" add -A
    git -C "$R" commit -q -m "hardener: add coverage"
    git -C "$R" checkout -q -b bl1315-sibling
    echo sibling > "$R/sib.txt"
    git -C "$R" add -A
    git -C "$R" commit -q -m "BL-9002: sibling unlanded work."
    git -C "$R" checkout -q main
    git -C "$R" merge --no-ff -q -m "BL-9001: documenter forward merge" bl1315-sibling
    CITED="$(git -C "$R" rev-parse HEAD)"
    ;;
  no-sibling)
    echo a > "$R/a.txt"
    git -C "$R" add -A
    git -C "$R" commit -q -m "BL-9001: part one"
    echo b > "$R/b.txt"
    git -C "$R" add -A
    git -C "$R" commit -q -m "BL-9001: part two"
    CITED="$(git -C "$R" rev-parse HEAD)"
    ;;
  earlier-merge)
    git -C "$R" checkout -q -b bl1315-own-work
    echo own > "$R/own.txt"
    git -C "$R" add -A
    git -C "$R" commit -q -m "BL-9001: own work."
    git -C "$R" checkout -q main
    git -C "$R" merge --no-ff -q -m "BL-9002: earlier sibling merge carries own work along" bl1315-own-work
    git -C "$R" commit -q --allow-empty -m "BL-9001: own ticket-tagged forward, nothing new"
    CITED="$(git -C "$R" rev-parse HEAD)"
    ;;
  *) echo "unknown shape: $SHAPE" >&2; exit 2 ;;
esac

FULL_DELIVERED="$(git -C "$R" diff --name-only origin/main "$CITED" | paste -sd, -)"
# The cited commit's OWN first-parent diff (:delivered, single-commit) -
# scenario 06's independent oracle that the ticket-tagged commit itself adds
# nothing, computed here (inside the fixture, where $R still exists) rather
# than by the caller after the work dir is torn down.
CITED_FIRST_PARENT_DIFF="$(git -C "$R" diff-tree --no-commit-id --name-only -r "$CITED" | paste -sd, -)"

OUT="$(bb "$CLI" "BL-9001-fixture" "$CITED" "$R" 2>&1)"
code=$?

action="$(head -1 <<<"$OUT" | awk '{print $1}')"
replay="$(head -1 <<<"$OUT" | awk '{print $3}')"

added=""
if [ "$action" = LAND_REPLAY ] && [ -n "$replay" ]; then
  added="$(git -C "$R" diff --name-only origin/main "$replay" | paste -sd, -)"
fi

reason=""
if [ "$action" = LAND_ESCALATE ]; then
  reason="$(sed -n '2,$p' <<<"$OUT")"
fi

export BL1315_EXIT="$code" BL1315_ACTION="$action" BL1315_REPLAY="$replay" \
       BL1315_ADDED="$added" BL1315_FULL="$FULL_DELIVERED" BL1315_CITED="$CITED" \
       BL1315_OUT="$OUT" BL1315_REASON="$reason" BL1315_CITED_FP="$CITED_FIRST_PARENT_DIFF"
python3 -c '
import json, os
def ids(v):
    return [x for x in v.split(",") if x]
print(json.dumps({
    "exit": int(os.environ["BL1315_EXIT"]),
    "action": os.environ["BL1315_ACTION"],
    "replayCommit": os.environ["BL1315_REPLAY"],
    "addedPaths": ids(os.environ["BL1315_ADDED"]),
    "fullDeliveredPaths": ids(os.environ["BL1315_FULL"]),
    "citedCommit": os.environ["BL1315_CITED"],
    "citedFirstParentDiff": ids(os.environ["BL1315_CITED_FP"]),
    "reason": os.environ["BL1315_REASON"],
    "out": os.environ["BL1315_OUT"],
}))
'
