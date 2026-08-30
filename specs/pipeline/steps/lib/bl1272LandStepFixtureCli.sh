#!/usr/bin/env bash
# BL-1272 acceptance driver: the REAL land_step_cli.bb over a REAL repository
# with a REAL bare origin, in the literal shape the defect was observed in -
# a sibling ticket's commit is an ancestor of the cited commit, and the
# sibling's content may or may not already be on origin/main as a DIFFERENT
# commit object (which is what a tip-pure replay produces).
#
# Usage: bl1272LandStepFixtureCli.sh <work-dir> <sibling-state>
#   sibling-state: byte-identical | absent | partial | unreadable
# Prints one JSON line:
#   {"exit":N,"action":str,"entangled":[...],"landed":[...],
#    "citedCommit":str,"replayCommit":str,"note":str}
set -uo pipefail

WORK="$1"
STATE="$2"
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

# The sibling's work, then this ticket's own work, on one linear branch - the
# ordinary pipelining shape, not misconduct.
printf 'sibling a\n' > "$R/sib_a.txt"
printf 'sibling b\n' > "$R/sib_b.txt"
git -C "$R" add -A
git -C "$R" commit -q -m "BL-9002: sibling work."
SIBLING="$(git -C "$R" rev-parse HEAD)"

printf 'own\n' > "$R/own.txt"
git -C "$R" add -A
git -C "$R" commit -q -m "BL-9001: own work."
CITED="$(git -C "$R" rev-parse HEAD)"

# Land some or none of the sibling's content on origin/main as a DIFFERENT
# commit object, exactly as a tip-pure replay does.
land_sibling() {
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

case "$STATE" in
  byte-identical) land_sibling sib_a.txt sib_b.txt ;;
  partial)        land_sibling sib_a.txt ;;
  absent)         : ;;
  unreadable)
    # The sibling's own diff can no longer be computed: its tree object is
    # gone, so `git diff-tree` on it fails while the commit walk still
    # succeeds. The attribution walk therefore attributes NO paths to the
    # sibling - the question "is its content on origin/main?" cannot be
    # answered, and must not be answered "yes".
    TREE="$(git -C "$R" rev-parse "$SIBLING^{tree}")"
    rm -f "$R/.git/objects/${TREE:0:2}/${TREE:2}"
    ;;
  *) echo "unknown sibling state: $STATE" >&2; exit 2 ;;
esac

OUT="$(bb "$CLI" "BL-9001-fixture" "$CITED" "$R" 2>&1)"
code=$?

action="$(head -1 <<<"$OUT" | awk '{print $1}')"
replay="$(head -1 <<<"$OUT" | awk '{print $3}')"
entangled="$(grep '^ENTANGLED_SIBLING ' <<<"$OUT" | awk '{print $2}' | paste -sd, -)"
landed="$(grep '^LANDED_SIBLING ' <<<"$OUT" | awk '{print $2}' | paste -sd, -)"

export BL1272_EXIT="$code" BL1272_ACTION="$action" BL1272_REPLAY="$replay" \
       BL1272_ENTANGLED="$entangled" BL1272_LANDED="$landed" \
       BL1272_CITED="$CITED" BL1272_OUT="$OUT"
python3 -c '
import json, os
def ids(v):
    return [x for x in v.split(",") if x]
print(json.dumps({
    "exit": int(os.environ["BL1272_EXIT"]),
    "action": os.environ["BL1272_ACTION"],
    "replayCommit": os.environ["BL1272_REPLAY"],
    "entangled": ids(os.environ["BL1272_ENTANGLED"]),
    "landed": ids(os.environ["BL1272_LANDED"]),
    "citedCommit": os.environ["BL1272_CITED"],
    "out": os.environ["BL1272_OUT"],
}))
'
