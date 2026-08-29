#!/usr/bin/env bash
# BL-1258: the addition-side twin of check_merge_deletion.sh (BL-1242).
# That guard refuses a merge that silently DROPS a path the target branch
# introduced. This one refuses a merge that silently RESTORES a path that
# was already retired - a branch that still carries a retired ticket's
# artefacts presents them as a clean one-sided ADD, which git takes with
# no conflict and no marker.
#
# The incident: BL-1247-reconcile-sweep-kill-switch was adjudicated a
# superseded id collision and retired, but the artefacts lived on every
# branch that had merged the mint - three uncoordinated retirements, on
# three branches, deleting three different path sets, none reaching
# `main`. A branch still carrying the mint later merged clean, and the
# retired ticket came back. Caught only by a reviewer reading the diff by
# hand.
#
# Reads the registry via retirement_registry_lib.bb's `refs/retirement/
# registry` - a ref every worktree of this repo can read the instant it
# is written, unlike a record committed to `main` (invisible to a branch
# that has not merged it, the very failure being fixed).
#
# Escape hatch, symmetric with check_merge_deletion.sh (BL-1242) and
# check_ticket_deletion.sh (BL-901): naming the retired ticket's id in the
# commit message confirms a DELIBERATE un-retirement and is allowed
# through - the refused role always has a clearable move (delete the
# paths on their own branch, the cheaper one; or name the id, a
# deliberate override).
#
# Usage: check_retirement_readdition.sh [commit-message-file]
#   Only fires when a merge is actually in progress (MERGE_HEAD exists).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

MSG_FILE="${1:-}"

MERGE_HEAD_PATH="$(git rev-parse --git-path MERGE_HEAD 2>/dev/null || true)"
if [[ -z "$MERGE_HEAD_PATH" || ! -f "$MERGE_HEAD_PATH" ]]; then
  # Not a merge commit - this guard has nothing to say.
  exit 0
fi

# path -> ticket-id, one retired path per line ("<path>\t<ticket-id>").
# Empty (no retirements recorded yet, or the ref cannot be read) is not an
# error - it just means this guard has nothing to check against.
registry_lines="$(bb "$SCRIPT_DIR/retirement_registry_cli.bb" "$REPO_ROOT" paths 2>/dev/null || true)"
if [[ -z "$registry_lines" ]]; then
  exit 0
fi

added_paths=()
while IFS=$'\t' read -r status path; do
  [[ -n "$status" && -n "$path" ]] || continue
  [[ "$status" == "A" ]] || continue
  added_paths+=("$path")
done < <(git diff --name-status HEAD --no-renames)

if [[ ${#added_paths[@]} -eq 0 ]]; then
  exit 0
fi

ticket_for_path() {
  local target="$1"
  while IFS=$'\t' read -r path id; do
    [[ "$path" == "$target" ]] && { printf '%s\n' "$id"; return 0; }
  done <<<"$registry_lines"
  return 1
}

if [[ -z "$MSG_FILE" || ! -r "$MSG_FILE" ]]; then
  # No message to check the naming exemption against yet - defer (should
  # not happen in practice: commit-msg always receives one).
  exit 0
fi
message="$(cat "$MSG_FILE")"

violations=()
for path in "${added_paths[@]}"; do
  id="$(ticket_for_path "$path")" || continue
  if printf '%s' "$message" | grep -qiE "\\b${id}\\b"; then
    continue
  fi
  violations+=("$id"$'\t'"$path")
done

if [[ ${#violations[@]} -eq 0 ]]; then
  exit 0
fi

for entry in "${violations[@]}"; do
  IFS=$'\t' read -r id path <<<"$entry"
  echo "Error: merge re-adds '$path', retired under ${id}, not named in the commit message." >&2
done
echo "Commit rejected: ${id:-a retired ticket}'s artefacts cannot re-enter through a merge. Delete the retired paths on this branch, or name the retired ticket id(s) in the commit message to confirm a deliberate un-retirement." >&2
exit 1
