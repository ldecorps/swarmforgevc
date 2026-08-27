#!/usr/bin/env bash
# BL-901: refuses a commit that silently deletes a backlog ticket YAML no
# other staged path accounts for and the commit message never names. See
# swarmforge/scripts/test/test_ticket_deletion_guard.sh.
#
# Usage: check_ticket_deletion.sh [commit-message-file]
#   Reads staged changes via `git diff --cached` and, when a message-file
#   path is given, the commit message from it. A deleted backlog ticket
#   YAML (backlog/paused/**, backlog/active/**, backlog/done/**) is exempt
#   when its ticket id also appears at another staged backlog ticket YAML
#   path (a promote/close move) or is named as a whole token in the commit
#   message.
#
#   Git invokes the pre-commit hook before the commit message exists (see
#   githooks(5): "invoked before obtaining the proposed commit log
#   message"), so a call with no message-file argument can only ever
#   exempt-or-defer, never refuse on message grounds - it always exits 0.
#   The enforcing call passes commit-msg's own "$1" (the message-file path
#   git always provides there), which git guarantees runs for the same
#   commit attempt whenever pre-commit passed.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

MSG_FILE="${1:-}"

is_ticket_path() {
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

ticket_id_of() {
  local base="${1##*/}"
  if [[ "$base" =~ ^([A-Za-z]+-[0-9]+)- ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
  fi
}

deleted_ids=()
deleted_paths=()
surviving_ids=()

while IFS=$'\t' read -r status path; do
  [[ -n "$status" && -n "$path" ]] || continue
  is_ticket_path "$path" || continue
  id="$(ticket_id_of "$path")"
  [[ -n "$id" ]] || continue
  if [[ "$status" == "D" ]]; then
    deleted_ids+=("$id")
    deleted_paths+=("$path")
  else
    surviving_ids+=("$id")
  fi
done < <(git diff --cached --no-renames --name-status)

naked=()
for i in "${!deleted_ids[@]}"; do
  id="${deleted_ids[$i]}"
  path="${deleted_paths[$i]}"
  survives=0
  for other in ${surviving_ids[@]+"${surviving_ids[@]}"}; do
    if [[ "$other" == "$id" ]]; then
      survives=1
      break
    fi
  done
  if [[ "$survives" -eq 0 ]]; then
    naked+=("$id"$'\t'"$path")
  fi
done

if [[ ${#naked[@]} -eq 0 ]]; then
  exit 0
fi

if [[ -z "$MSG_FILE" || ! -r "$MSG_FILE" ]]; then
  # Pre-commit time: the commit message does not exist yet. Defer.
  exit 0
fi

message="$(cat "$MSG_FILE")"

violations=()
for entry in "${naked[@]}"; do
  id="${entry%%$'\t'*}"
  path="${entry#*$'\t'}"
  if printf '%s' "$message" | grep -qiE "\\b${id}\\b"; then
    continue
  fi
  violations+=("$id"$'\t'"$path")
done

if [[ ${#violations[@]} -eq 0 ]]; then
  exit 0
fi

for entry in "${violations[@]}"; do
  id="${entry%%$'\t'*}"
  path="${entry#*$'\t'}"
  echo "Error: commit deletes '$path' ($id), which appears at no other staged path and is not named in the commit message." >&2
done
echo "Commit rejected: name the ticket id in the commit message to confirm a deliberate retirement (e.g. \"Retire $id: ...\")." >&2
exit 1
