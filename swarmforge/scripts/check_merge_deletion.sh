#!/usr/bin/env bash
# BL-1242: sibling guard to check_ticket_deletion.sh (BL-901), covering the
# paths that guard's ticket-YAML-only predicate does not - refuses a MERGE
# commit that silently removes a path the receiving branch (HEAD, before
# the merge) itself introduced, unless the commit message names the ticket
# that path belongs to (derived from the subject of the commit, on HEAD's
# own history, that most recently introduced/touched it - the same
# leading "TICKET: description" convention this repo's other guards
# already extract from).
#
# The 2026-08-28 incident: QA approved BL-1227 and broadcast a merge-up.
# Merging QA's commit resolved as "theirs deleted, ours unchanged" for six
# non-ticket-YAML paths belonging to four different tickets QA had
# reverted on its own branch - no conflict marker, no failing hook, a
# clean-looking merge. Caught only because the receiving role happened to
# read the diff by hand (engineering.prompt's own guardrail).
#
# Usage: check_merge_deletion.sh [commit-message-file]
#   Only fires when a merge is actually in progress (MERGE_HEAD exists) -
#   an ordinary commit is untouched. Reads the about-to-be-committed tree
#   via `git diff --name-status HEAD` (HEAD is still the pre-merge tip at
#   this point; the index already holds the merged result), so a deletion
#   here is exactly a path HEAD had that the merge result does not.
#
#   Git invokes commit-msg (not pre-commit) for `git merge --no-ff`
#   (probed 2026-08-28: pre-merge-commit and commit-msg both fire,
#   pre-commit does not) - see the required_wiring note in
#   swarmforge/git-hooks/commit-msg. This script needs no separate
#   pre-commit call the way check_ticket_deletion.sh does: there is no
#   earlier hook point to defer from for a merge.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

MSG_FILE="${1:-}"

MERGE_HEAD_PATH="$(git rev-parse --git-path MERGE_HEAD 2>/dev/null || true)"
if [[ -z "$MERGE_HEAD_PATH" || ! -f "$MERGE_HEAD_PATH" ]]; then
  # Not a merge commit - this guard has nothing to say.
  exit 0
fi

# BL-901's own domain - never double-report (qa_e2e_procedure step 5).
is_ticket_yaml_path() {
  case "$1" in
    backlog/paused/*.yaml|backlog/paused/*.yml| \
    backlog/active/*.yaml|backlog/active/*.yml| \
    backlog/done/*.yaml|backlog/done/*.yml| \
    backlog/done/*/*.yaml|backlog/done/*/*.yml)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

deleted_paths=()
while IFS=$'\t' read -r status path; do
  [[ -n "$status" && -n "$path" ]] || continue
  [[ "$status" == "D" ]] || continue
  is_ticket_yaml_path "$path" && continue
  deleted_paths+=("$path")
done < <(git diff --name-status HEAD --no-renames)

if [[ ${#deleted_paths[@]} -eq 0 ]]; then
  exit 0
fi

if [[ -z "$MSG_FILE" || ! -r "$MSG_FILE" ]]; then
  # No message to check against yet - defer (should not happen in
  # practice: commit-msg always receives one).
  exit 0
fi

message="$(cat "$MSG_FILE")"

# The ticket id from the subject of the most recent commit on HEAD's own
# history that touched this path - "the commit on the branch that
# introduced them" (qa_e2e_procedure step 2). Empty when no HEAD commit
# ever touched it (should not happen for a real deletion) or its subject
# names no ticket - a path this guard cannot attribute is still reported,
# just without an id to match against the message, so it always refuses
# rather than silently passing on an attribution gap.
ticket_id_for_path() {
  local path="$1" subject
  subject="$(git log -1 --format=%s HEAD -- "$path" 2>/dev/null || true)"
  if [[ "$subject" =~ ([A-Za-z]+-[0-9]+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
  fi
}

introducing_commit_for_path() {
  git log -1 --format=%h HEAD -- "$1" 2>/dev/null || true
}

violations=()
for path in "${deleted_paths[@]}"; do
  id="$(ticket_id_for_path "$path")"
  if [[ -n "$id" ]] && printf '%s' "$message" | grep -qiE "\\b${id}\\b"; then
    continue
  fi
  commit="$(introducing_commit_for_path "$path")"
  violations+=("${id:-(unattributed)}"$'\t'"$path"$'\t'"${commit:-unknown}")
done

if [[ ${#violations[@]} -eq 0 ]]; then
  exit 0
fi

for entry in "${violations[@]}"; do
  IFS=$'\t' read -r id path commit <<<"$entry"
  echo "Error: merge deletes '$path' (${id}, introduced at ${commit} on this branch), not named in the commit message." >&2
done
echo "Commit rejected: name the affected ticket id(s) in the commit message to confirm a deliberate removal, or re-merge the branch commit(s) that introduced these paths first." >&2
exit 1
