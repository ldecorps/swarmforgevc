#!/usr/bin/env bash
# Archive stale inbox/new mail and clear ambiguous in_process state so agents
# can pick up the current parcel. Safe for live swarms — never deletes, only
# moves under inbox/completed/stale-sweep-<timestamp>/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${1:-.}" && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MOVED=0

sweep_role_inbox() {
  local inbox="$1"
  local keep_new="${2:-}"

  [[ -d "$inbox/new" ]] || return 0
  local archive="$inbox/completed/stale-sweep-$STAMP"
  mkdir -p "$archive"

  shopt -s nullglob
  local f base
  for f in "$inbox/new"/*.handoff; do
    base="$(basename "$f")"
    if [[ -n "$keep_new" && "$base" == "$keep_new" ]]; then
      continue
    fi
    mv "$f" "$archive/"
    MOVED=$((MOVED + 1))
  done
  shopt -u nullglob
}

clear_in_process_files() {
  local inbox="$1"
  local archive="$inbox/completed/stale-sweep-$STAMP"
  mkdir -p "$archive"

  shopt -s nullglob
  local f
  for f in "$inbox/in_process"/*.handoff; do
    mv "$f" "$archive/"
    MOVED=$((MOVED + 1))
  done
  shopt -u nullglob
}

clear_in_process_batches() {
  local inbox="$1"
  local archive="$inbox/completed/stale-sweep-$STAMP"
  mkdir -p "$archive"

  shopt -s nullglob
  local d
  for d in "$inbox/in_process"/batch_*; do
    [[ -d "$d" ]] || continue
    mv "$d" "$archive/"
    MOVED=$((MOVED + 1))
  done
  shopt -u nullglob
}

sweep_inbox() {
  local inbox="$1"
  local role="${2:-}"

  case "$role" in
    cleaner)
      sweep_role_inbox "$inbox" "50_20260708T154813Z_000130_from_coder_to_cleaner_for_cleaner.handoff"
      clear_in_process_batches "$inbox"
      ;;
    master)
      clear_in_process_files "$inbox"
      sweep_role_inbox "$inbox"
      ;;
    *)
      sweep_role_inbox "$inbox"
      ;;
  esac
}

# BL-128: coordinator and specifier each now have their own physical
# mailbox on the shared master worktree (no longer one shared inbox), so
# each master-resident role's own subdirectory is swept individually -
# resolved via mailbox_dir.bb, the one shared path resolver, rather than
# re-deriving the <role> subdirectory join here.
if [[ -f "$ROOT/.swarmforge/roles.tsv" ]]; then
  while IFS= read -r role; do
    [[ -n "$role" ]] || continue
    sweep_inbox "$(bb "$SCRIPT_DIR/mailbox_dir.bb" "$ROOT" "$role" new | xargs dirname)" master
  done < <(awk -F'\t' '$2 == "master" { print $1 }' "$ROOT/.swarmforge/roles.tsv")
fi

shopt -s nullglob
for wt in "$ROOT/.worktrees"/*; do
  [[ -d "$wt" ]] || continue
  sweep_inbox "$wt/.swarmforge/handoffs/inbox" "$(basename "$wt")"
done
shopt -u nullglob

echo "Stale inbox sweep moved $MOVED item(s) to completed/stale-sweep-$STAMP"
