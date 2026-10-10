#!/usr/bin/env bash
# BL-1885: refuses a hotfix commit (Hotfix-Certification: trailer, Stamp-off:
# BL-nnnn line) whose stamp-off ticket already has a build in flight - a
# live git_handoff parcel in any role's mailbox at a commit not on main, or
# a commit naming the ticket on a role branch that is not on main and not
# in the ticket's own abandoned_commits - unless the message names every
# such build as superseded (Supersedes-Build: <sha>, one per line).
#
# The 2026-10-02 incident this closes: the specifier hotfixed BL-1877 while
# the coder's own build of it, 7613ab0006, sat unclaimed in QA's new/ as
# parcel 002306; the duplicate landed and had to be unwound by hand.
#
# Usage: check_hotfix_duplicate_build.sh [commit-message-file]
#   Only fires on a message carrying BOTH the Hotfix-Certification: trailer
#   and a Stamp-off: BL-nnnn line - every other commit is silent, exit 0.
#   An unreadable project root or finder failure warns and commits
#   (fail-open, same posture as this chain's sibling guards).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

MSG_FILE="${1:-}"
if [[ -z "$MSG_FILE" || ! -r "$MSG_FILE" ]]; then
  # Pre-commit time (no message yet) or nothing to read: defer.
  exit 0
fi

MESSAGE="$(cat "$MSG_FILE")"

if ! printf '%s\n' "$MESSAGE" | grep -qE '^[[:space:]]*Hotfix-Certification:'; then
  exit 0
fi

STAMP_OFF_LINE="$(printf '%s\n' "$MESSAGE" | grep -E '^[[:space:]]*Stamp-off:' | head -1)"
if [[ -z "$STAMP_OFF_LINE" ]]; then
  # A hotfix with no Stamp-off: line names no ticket for this guard to
  # check against - nothing to do.
  exit 0
fi

TICKET_ID="$(printf '%s' "$STAMP_OFF_LINE" | sed -E 's/^[[:space:]]*Stamp-off:[[:space:]]*//' \
  | grep -oiE '(BL|GH)-?[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]' | sed -E 's/^([A-Z]+)-?([0-9]+)$/\1-\2/')"
if [[ -z "$TICKET_ID" ]]; then
  echo "check_hotfix_duplicate_build: WARNING - Stamp-off: line names no ticket id; not checking." >&2
  exit 0
fi

BLOCKERS_RAW="$(bb "$SCRIPT_DIR/hotfix_duplicate_build_cli.bb" "$REPO_ROOT" "$TICKET_ID" 2>/dev/null)"
BB_STATUS=$?
if [[ "$BB_STATUS" -ne 0 ]]; then
  echo "check_hotfix_duplicate_build: WARNING - could not look up builds in flight for $TICKET_ID; not checking." >&2
  exit 0
fi

if [[ -z "$BLOCKERS_RAW" ]]; then
  exit 0
fi

superseded=()
while IFS= read -r line; do
  trimmed="$(printf '%s' "$line" | sed -E 's/^[[:space:]]*Supersedes-Build:[[:space:]]*//')"
  [[ -n "$trimmed" ]] && superseded+=("$trimmed")
done < <(printf '%s\n' "$MESSAGE" | grep -E '^[[:space:]]*Supersedes-Build:')

is_superseded() {
  local sha="$1" s
  for s in ${superseded[@]+"${superseded[@]}"}; do
    [[ "$sha" == "$s"* || "$s" == "$sha"* ]] && return 0
  done
  return 1
}

remaining=()
while IFS=$'\t' read -r kind role commit file; do
  [[ -n "$kind" ]] || continue
  is_superseded "$commit" && continue
  remaining+=("$kind"$'\t'"$role"$'\t'"$commit"$'\t'"$file")
done <<<"$BLOCKERS_RAW"

if [[ ${#remaining[@]} -eq 0 ]]; then
  exit 0
fi

echo "Error: hotfix commit names $TICKET_ID as Stamp-off, but a build is already in flight for it:" >&2
for entry in "${remaining[@]}"; do
  IFS=$'\t' read -r kind role commit file <<<"$entry"
  if [[ "$kind" == "mailbox" ]]; then
    echo "  - a live parcel at $role (${file}, commit $commit)" >&2
  else
    echo "  - an unlanded commit on the $role branch ($commit)" >&2
  fi
done
echo "Commit rejected: this hotfix would duplicate work already on its way through the pipeline." >&2
echo "Add a \"Supersedes-Build: <sha>\" line for each commit named above to confirm it is genuinely superseded, or wait for it to land." >&2
exit 1
