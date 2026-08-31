#!/usr/bin/env bash
# BL-1298 acceptance driver: the REAL land_step_cli.bb over a REAL repository
# with a REAL bare origin and a REAL linked worktree, in the literal shape the
# defect was observed in - a role standing in its own `.worktrees/<role>`
# checkout, where `.git` is a FILE and not a directory.
#
# Usage: bl1298ReplayWorktreeFixtureCli.sh <work-dir> <mode>
#   mode: main-checkout | linked-worktree | create-fails | retry-after-failure
# Prints one JSON line:
#   {"exit":N,"action":str,"branch":str,"replayCommit":str,"replayedPaths":[...],
#    "branchAfter":str,"firstReason":str,"secondExit":N,"secondReason":str}
set -uo pipefail

WORK="$1"
MODE="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
CLI="$REPO_ROOT/swarmforge/scripts/land_step_cli.bb"

# An ambient GIT_DIR/GIT_WORK_TREE hijacks every `git` below onto whatever
# repository the caller happened to be standing in, which for an acceptance
# run is this repository (BL-1200/BL-1222).
unset GIT_DIR GIT_WORK_TREE

ORIGIN="$WORK/origin.git"
R="$WORK/repo"
WT="$WORK/linked-wt"

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

# The sibling's unlanded work, then this ticket's own work, on one linear
# branch - ordinary pipelining, which is what makes the tip entangled.
printf 'sibling\n' > "$R/sib.txt"
git -C "$R" add -A
git -C "$R" commit -q -m "BL-9002: sibling work."

printf 'own\n' > "$R/own.txt"
git -C "$R" add -A
git -C "$R" commit -q -m "BL-9001: own work."
CITED="$(git -C "$R" rev-parse HEAD)"
SHORT="${CITED:0:10}"
BRANCH="land-replay/BL-9001-$SHORT"

# A REAL linked worktree: `$WT/.git` is a FILE holding `gitdir: ...`, which is
# the whole defect. Detached so it holds no branch of its own.
git -C "$R" worktree add -q --detach "$WT" HEAD

# Where the replay's scratch checkout must go. Both checkouts resolve to the
# SAME directory - that is invariant 1 - so one path serves every mode.
COMMON_DIR="$(git -C "$R" rev-parse --path-format=absolute --git-common-dir 2>/dev/null \
  || echo "$R/.git")"
SCRATCH="$COMMON_DIR/land-replay-worktrees/BL-9001-$SHORT"

run_from() {
  # No third argument: the point of this ticket is that the caller must not
  # have to know about the master-checkout workaround.
  ( cd "$1" && bb "$CLI" "BL-9001-fixture" "$CITED" 2>&1 )
}

exit2=0; reason2=""; reason1=""
case "$MODE" in
  main-checkout)   OUT="$(run_from "$R")";  code=$? ;;
  linked-worktree) OUT="$(run_from "$WT")"; code=$? ;;
  create-fails)
    # A regular FILE where the scratch checkout must go. `git worktree add -b`
    # creates the branch and only THEN fails to make the checkout, so this is
    # the path that used to leak a branch.
    mkdir -p "$(dirname "$SCRATCH")"
    printf 'not a directory\n' > "$SCRATCH"
    OUT="$(run_from "$R")"; code=$?
    reason1="$(tail -1 <<<"$OUT")"
    ;;
  retry-after-failure)
    mkdir -p "$(dirname "$SCRATCH")"
    printf 'not a directory\n' > "$SCRATCH"
    OUT="$(run_from "$R")"; code=$?
    reason1="$(tail -1 <<<"$OUT")"
    # Remove the first attempt's reason. Anything the retry now reports is a
    # reason the FIRST attempt did not have - which is the defect.
    rm -rf "$SCRATCH"
    OUT2="$(run_from "$R")"; exit2=$?
    reason2="$(tail -1 <<<"$OUT2")"
    ;;
  *) echo "unknown mode: $MODE" >&2; exit 2 ;;
esac

action="$(head -1 <<<"$OUT" | awk '{print $1}')"
branch="$(head -1 <<<"$OUT" | awk '{print $2}')"
replay="$(head -1 <<<"$OUT" | awk '{print $3}')"
if [ "$action" = "LAND_REPLAY" ]; then
  paths="$(git -C "$R" diff-tree -r --no-commit-id --name-only "$replay" | paste -sd, -)"
  parent="$(git -C "$R" rev-parse "$replay^")"
  tree="$(git -C "$R" rev-parse "$replay^{tree}")"
else
  paths=""; parent=""; tree=""; branch=""; replay=""
fi
branch_after="$(git -C "$R" branch --list "$BRANCH" | tr -d ' *')"
origin_main="$(git -C "$R" rev-parse origin/main)"

export B_EXIT="$code" B_ACTION="$action" B_BRANCH="$branch" B_REPLAY="$replay" \
       B_PATHS="$paths" B_PARENT="$parent" B_TREE="$tree" B_AFTER="$branch_after" \
       B_ORIGIN="$origin_main" B_R1="$reason1" B_EXIT2="$exit2" B_R2="$reason2" \
       B_OUT="$OUT"
python3 -c '
import json, os
print(json.dumps({
    "exit": int(os.environ["B_EXIT"]),
    "action": os.environ["B_ACTION"],
    "branch": os.environ["B_BRANCH"],
    "replayCommit": os.environ["B_REPLAY"],
    "replayedPaths": [p for p in os.environ["B_PATHS"].split(",") if p],
    "replayParent": os.environ["B_PARENT"],
    "replayTree": os.environ["B_TREE"],
    "branchAfter": os.environ["B_AFTER"],
    "originMain": os.environ["B_ORIGIN"],
    "firstReason": os.environ["B_R1"],
    "secondExit": int(os.environ["B_EXIT2"]),
    "secondReason": os.environ["B_R2"],
    "out": os.environ["B_OUT"],
}))
'
