#!/usr/bin/env bash
# BL-1308 acceptance driver: the REAL land_step_cli.bb over a REAL repository
# with a REAL bare origin, in the literal shape the defect was observed in -
# an unlanded sibling ticket's untagged commits riding into a forward-merge
# whose subject names the CITED ticket, so they are reachable only through
# that merge's SECOND parent.
#
# Usage: bl1308SiblingDetectorFixtureCli.sh <work-dir> <position>
#   position: first-parent | second-parent | unreadable-ancestry
# Prints one JSON line:
#   {"exit":N,"action":str,"entangled":[...],"landed":[...],
#    "citedCommit":str,"replayCommit":str,"replayAdded":[...],
#    "attribution":{path:[ids]},"out":str}
#
# `attribution` is an INDEPENDENT oracle: it asks git log which ticket-tagged
# commit in the cited range touched each path, never land_step_lib.bb.
set -uo pipefail

WORK="$1"
POSITION="$2"
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

sibling_work() {
  printf 'sibling a\n' > "$R/sib_a.txt"
  printf 'sibling b\n' > "$R/sib_b.txt"
  git -C "$R" add -A
  git -C "$R" commit -q -m "BL-9002: sibling work still parked upstream."
  git -C "$R" rev-parse HEAD
}

own_work() {
  printf 'own\n' > "$R/own.txt"
  git -C "$R" add -A
  git -C "$R" commit -q -m "BL-9001: own work."
}

case "$POSITION" in
  first-parent)
    # The already-covered shape: the sibling sits directly on the
    # first-parent walk from origin/main.
    SIBLING="$(sibling_work)"
    own_work
    ;;
  second-parent|unreadable-ancestry)
    # The forward-merge shape. The sibling's commits are made on a side
    # branch under their OWN subjects, then arrive through a merge whose
    # subject names the cited ticket - so nothing on the first-parent walk
    # ever names the sibling.
    git -C "$R" checkout -q -b bl1308-sibling
    SIBLING="$(sibling_work)"
    git -C "$R" checkout -q main
    own_work
    git -C "$R" merge --no-ff -q -m "BL-9001: forward merge for the next role." bl1308-sibling
    ;;
  *) echo "unknown position: $POSITION" >&2; exit 2 ;;
esac

CITED="$(git -C "$R" rev-parse HEAD)"

if [ "$POSITION" = unreadable-ancestry ]; then
  # The ancestry walk itself cannot be completed: a commit object in the
  # cited range is gone, so `git rev-list origin/main..<cited>` fails.
  rm -f "$R/.git/objects/${SIBLING:0:2}/${SIBLING:2}"
fi

OUT="$(bb "$CLI" "BL-9001-fixture" "$CITED" "$R" 2>&1)"
code=$?

action="$(head -1 <<<"$OUT" | awk '{print $1}')"
replay="$(head -1 <<<"$OUT" | awk '{print $3}')"
entangled="$(grep '^ENTANGLED_SIBLING ' <<<"$OUT" | awk '{print $2}' | paste -sd, -)"
landed="$(grep '^LANDED_SIBLING ' <<<"$OUT" | awk '{print $2}' | paste -sd, -)"

added=""
attribution=""
if [ "$action" = LAND_REPLAY ] && [ -n "$replay" ]; then
  added="$(git -C "$R" diff --diff-filter=A --name-only origin/main "$replay" | paste -sd, -)"
  for p in $(tr ',' ' ' <<<"$added"); do
    ids="$(git -C "$R" log --format=%s "origin/main..$CITED" -- "$p" \
             | grep -oE 'BL-[0-9]+' | sort -u | paste -sd' ' -)"
    attribution="${attribution}${attribution:+;}${p}=${ids}"
  done
fi

export BL1308_EXIT="$code" BL1308_ACTION="$action" BL1308_REPLAY="$replay" \
       BL1308_ENTANGLED="$entangled" BL1308_LANDED="$landed" \
       BL1308_CITED="$CITED" BL1308_OUT="$OUT" BL1308_ADDED="$added" \
       BL1308_ATTRIBUTION="$attribution"
python3 -c '
import json, os
def ids(v):
    return [x for x in v.split(",") if x]
attribution = {}
for entry in os.environ["BL1308_ATTRIBUTION"].split(";"):
    if not entry:
        continue
    path, _, tickets = entry.partition("=")
    attribution[path] = [t for t in tickets.split(" ") if t]
print(json.dumps({
    "exit": int(os.environ["BL1308_EXIT"]),
    "action": os.environ["BL1308_ACTION"],
    "replayCommit": os.environ["BL1308_REPLAY"],
    "entangled": ids(os.environ["BL1308_ENTANGLED"]),
    "landed": ids(os.environ["BL1308_LANDED"]),
    "citedCommit": os.environ["BL1308_CITED"],
    "replayAdded": ids(os.environ["BL1308_ADDED"]),
    "attribution": attribution,
    "out": os.environ["BL1308_OUT"],
}))
'
