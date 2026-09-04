#!/usr/bin/env bash
# BL-1309 acceptance fixture: drive the REAL land_main_publish.sh --decide-only
# over a REAL repository with a REAL bare origin.
#
# Usage: bl1309LandDecideFixtureCli.sh <work-dir> <shape>
#   shapes: clean | landed-sibling | unlanded-sibling | withheld-sibling
#           | no-detector | unreadable-range
# Prints one JSON line: {"exit":N,"marker":bool,"advises":bool,"out":"..."}
#
# A real bare origin, never the repo's own .git: the script fetches
# origin/main on every run, so a self-remote refreshes origin/main back to HEAD
# and the entanglement under test vanishes before it is measured.
set -uo pipefail

WORK="$1"
SHAPE="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SCRIPTS="$REPO_ROOT/swarmforge/scripts"
CLI="$SCRIPTS/land_main_publish.sh"

ORIGIN="$WORK/origin.git"
R="$WORK/repo"

git init -q --bare -b main "$ORIGIN"
git init -q -b main "$R"
mkdir -p "$R/.swarmforge"
git -C "$R" config user.email t@t
git -C "$R" config user.name t
git -C "$R" config commit.gpgsign false
git -C "$R" remote add origin "$ORIGIN"
git -C "$R" commit -q --allow-empty -m "seed"
git -C "$R" push -q origin main

commit_file() {
  printf '%s\n' "$2" >"$R/$1"
  git -C "$R" add -A
  git -C "$R" commit -q -m "$3"
}

case "$SHAPE" in
  clean)
    commit_file own.txt "own" "BL-9001: the ticket being landed"
    ;;
  landed-sibling)
    commit_file sibling.txt "sibling" "BL-9002: the sibling's own work"
    git -C "$R" push -q origin main
    commit_file own.txt "own" "BL-9001: the ticket being landed"
    ;;
  unlanded-sibling|no-detector|unreadable-range)
    commit_file sibling.txt "sibling" "BL-9002: the sibling's own work"
    commit_file own.txt "own" "BL-9001: the ticket being landed"
    ;;
  withheld-sibling)
    # The 2026-08-31 shape: the sibling reaches the tip as a MERGE, the way a
    # QA branch carries a ticket it decided not to land.
    git -C "$R" checkout -q -b withheld
    commit_file withheld.txt "withheld" "BL-9003: held pending a human ruling"
    git -C "$R" checkout -q main
    git -C "$R" merge -q --no-ff -m "Merge BL-9003 into QA (landing blocked on pending human ruling)" withheld
    commit_file own.txt "own" "BL-9001: the ticket being landed"
    ;;
  *) echo "unknown shape: $SHAPE" >&2; exit 2 ;;
esac

RUN_CLI="$CLI"
if [[ "$SHAPE" == "no-detector" ]]; then
  # The detector is simply not on disk beside the script.
  FAKE="$WORK/scripts"
  mkdir -p "$FAKE"
  cp "$CLI" "$FAKE/land_main_publish.sh"
  cp "$SCRIPTS/master_main_reconcile_lib.bb" "$FAKE/"
  RUN_CLI="$FAKE/land_main_publish.sh"
fi
if [[ "$SHAPE" == "unreadable-range" ]]; then
  # origin/main names an object this repository does not have, so the range
  # against it cannot be resolved at all. The origin itself is removed first so
  # the script's own fetch cannot quietly repair the ref back to a readable
  # one - the fetch failure is already tolerated by the script.
  rm -rf "$ORIGIN"
  mkdir -p "$R/.git/refs/remotes/origin"
  printf '%s\n' "0123456789abcdef0123456789abcdef01234567" \
    >"$R/.git/refs/remotes/origin/main"
fi

OUT="$(bash "$RUN_CLI" "$R" --decide-only 2>&1)"
CODE=$?

MARKER=false
grep -q 'ENTANGLED_SIBLING_BLOCK' <<<"$OUT" && MARKER=true
ADVISES=false
grep -q ':purity-action' <<<"$OUT" && ADVISES=true

BL1309_OUT="$OUT" BL1309_CODE="$CODE" BL1309_MARKER="$MARKER" BL1309_ADVISES="$ADVISES" \
  python3 -c 'import json, os; print(json.dumps({
    "exit": int(os.environ["BL1309_CODE"]),
    "marker": os.environ["BL1309_MARKER"] == "true",
    "advises": os.environ["BL1309_ADVISES"] == "true",
    "out": os.environ["BL1309_OUT"],
}))'
