#!/usr/bin/env bash
# BL-1720: retires a seat from every roster copy the swarm reads - master
# roles.tsv, sessions.tsv, and every worktree's own roles.tsv copy
# (including the retired seat's own) - in ONE operation, then kills its
# tmux session LAST, so the babysitter's repair sweep never sees a missing
# session that a roster copy still lists (the exact 2026-09-24 incident:
# the session died first, roster edits followed minutes later, and every
# copy in between kept addressing and resurrecting it).
#
# The seat's worktree, branch and mailbox are left in place - this verb
# never moves or deletes them; it only reports what still sits in the
# retired seat's inbox (new/ and in_process/) for the caller to decide.
#
# Usage: retire_seat.sh <project-root> <seat>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/retire_seat_lib.bb"

usage() {
  echo "Usage: retire_seat.sh <project-root> <seat>" >&2
  exit 1
}

[[ $# -eq 2 ]] || usage

ROOT="$1"
SEAT="$2"
STATE_DIR="$ROOT/.swarmforge"
ROLES_FILE="$STATE_DIR/roles.tsv"
SESSIONS_FILE="$STATE_DIR/sessions.tsv"
SOCKET_FILE="$STATE_DIR/tmux-socket"

[[ -f "$ROLES_FILE" ]] || { echo "retire_seat: refusing - no roles.tsv at $ROLES_FILE" >&2; exit 1; }

lib_call() {
  local expr="$1"; shift
  bb -e "(load-file \"$LIB\") $expr" "$@"
}

ORIGINAL_ROLES="$(cat "$ROLES_FILE")"

SEAT_ROW_JSON="$(printf '%s' "$ORIGINAL_ROLES" | lib_call '(let [text (slurp *in*)] (println (pr-str (retire-seat-lib/seat-row text (first *command-line-args*)))))' "$SEAT")"
if [[ "$SEAT_ROW_JSON" == "nil" ]]; then
  echo "retire_seat: refusing - unknown seat '$SEAT' (no row in $ROLES_FILE)" >&2
  exit 1
fi

# Extract the retired seat's own session (col 3) and worktree path (col 2)
# from its OWN row, BEFORE any file is touched.
SEAT_SESSION="$(printf '%s\n' "$ORIGINAL_ROLES" | awk -F'\t' -v seat="$SEAT" '$1==seat{print $4; exit}')"
SEAT_WORKTREE="$(printf '%s\n' "$ORIGINAL_ROLES" | awk -F'\t' -v seat="$SEAT" '$1==seat{print $3; exit}')"

# Every worktree path from the ORIGINAL (pre-filter) roster, including the
# retired seat's own - captured before the master is rewritten, since the
# filtered master would no longer name it.
WORKTREE_PATHS=()
while IFS= read -r line; do
  [[ -n "$line" ]] && WORKTREE_PATHS+=("$line")
done < <(printf '%s' "$ORIGINAL_ROLES" | lib_call '(println (clojure.string/join "\n" (retire-seat-lib/worktree-paths (slurp *in*))))')

# One operation: master roles.tsv, then sessions.tsv, then every worktree
# copy (including the retired seat's own) - the session is killed only
# after every one of these has already lost the row.
NEW_ROLES="$(printf '%s' "$ORIGINAL_ROLES" | lib_call '(println (retire-seat-lib/filter-out-seat-rows (slurp *in*) (first *command-line-args*) 0))' "$SEAT")"
printf '%s\n' "$NEW_ROLES" > "$ROLES_FILE"

if [[ -f "$SESSIONS_FILE" ]]; then
  NEW_SESSIONS="$(lib_call '(println (retire-seat-lib/filter-out-seat-rows (slurp *in*) (first *command-line-args*) 1))' "$SEAT" < "$SESSIONS_FILE")"
  printf '%s\n' "$NEW_SESSIONS" > "$SESSIONS_FILE"
fi

for wt in "${WORKTREE_PATHS[@]}"; do
  [[ "$wt" != "$ROOT" ]] || continue
  wt_roles="$wt/.swarmforge/roles.tsv"
  [[ -f "$wt_roles" ]] || continue
  wt_new="$(lib_call '(println (retire-seat-lib/filter-out-seat-rows (slurp *in*) (first *command-line-args*) 0))' "$SEAT" < "$wt_roles")"
  printf '%s\n' "$wt_new" > "$wt_roles"
done

# The retired seat's OWN worktree copy loses its row too - "left in place"
# means its files survive, not that its own roster keeps listing it.
if [[ -n "$SEAT_WORKTREE" && "$SEAT_WORKTREE" != "$ROOT" ]]; then
  seat_own_roles="$SEAT_WORKTREE/.swarmforge/roles.tsv"
  if [[ -f "$seat_own_roles" ]]; then
    seat_own_new="$(lib_call '(println (retire-seat-lib/filter-out-seat-rows (slurp *in*) (first *command-line-args*) 0))' "$SEAT" < "$seat_own_roles")"
    printf '%s\n' "$seat_own_new" > "$seat_own_roles"
  fi
fi

# Session killed LAST, after every roster copy has already lost the row.
if [[ -n "$SEAT_SESSION" && -f "$SOCKET_FILE" ]]; then
  SOCK="$(cat "$SOCKET_FILE")"
  tmux -S "$SOCK" kill-session -t "$SEAT_SESSION" 2>/dev/null || true
fi

# Report parcels still in the retired seat's own mailbox, for the caller
# to decide - never moved or deleted here.
if [[ -n "$SEAT_WORKTREE" ]]; then
  for dir in "$SEAT_WORKTREE/.swarmforge/handoffs/inbox/new" "$SEAT_WORKTREE/.swarmforge/handoffs/inbox/in_process"; do
    [[ -d "$dir" ]] || continue
    for f in "$dir"/*.handoff; do
      [[ -e "$f" ]] || continue
      echo "RETIRED_SEAT_MAILBOX_PARCEL: $f"
    done
  done
fi

echo "RETIRED_SEAT: $SEAT"
