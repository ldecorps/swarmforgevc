#!/usr/bin/env bash
# Full inbox reset: archive every pending parcel (new + in_process + batches).
# Safe — never deletes handoffs; moves to inbox/completed/full-sweep-<timestamp>/.
#
# Usage: sweep_all_inbox.sh [repo-root]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${1:-.}" && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MOVED=0

archive_inbox() {
  local inbox="$1"
  [[ -d "$inbox" ]] || return 0
  local archive="$inbox/completed/full-sweep-$STAMP"
  mkdir -p "$archive"

  shopt -s nullglob
  local f d
  for f in "$inbox/new"/*.handoff "$inbox/new"/*.chase.json; do
    [[ -e "$f" ]] || continue
    mv "$f" "$archive/"
    MOVED=$((MOVED + 1))
  done
  for f in "$inbox/in_process"/*.handoff; do
    mv "$f" "$archive/"
    MOVED=$((MOVED + 1))
  done
  for d in "$inbox/in_process"/batch_*; do
    [[ -d "$d" ]] || continue
    mv "$d" "$archive/"
    MOVED=$((MOVED + 1))
  done
  shopt -u nullglob
}

# BL-128: each master-resident role now has its own physical mailbox
# subdirectory - resolved via mailbox_dir.bb, the one shared path resolver.
if [[ -f "$ROOT/.swarmforge/roles.tsv" ]]; then
  while IFS= read -r role; do
    [[ -n "$role" ]] || continue
    archive_inbox "$(bb "$SCRIPT_DIR/mailbox_dir.bb" "$ROOT" "$role" new | xargs dirname)"
  done < <(awk -F'\t' '$2 == "master" { print $1 }' "$ROOT/.swarmforge/roles.tsv")
fi

shopt -s nullglob
for wt in "$ROOT/.worktrees"/*; do
  [[ -d "$wt" ]] || continue
  archive_inbox "$wt/.swarmforge/handoffs/inbox"
done
shopt -u nullglob

echo "Full inbox sweep archived $MOVED item(s) under full-sweep-$STAMP"
