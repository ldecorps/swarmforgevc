#!/usr/bin/env bash
# BL-1617: refuses a role-branch commit whose subject the land step's own
# subject-attribution (land_step_lib.bb's subject-attribution/leading-
# ticket-id) would read as owned by a ticket closed on origin/main, by no
# ticket at all there, or ambiguously by several with none leading -
# BEFORE the land step catches it an hour later, on someone else's parcel
# (BL-1576's evidence commit blocked two QA-approved lands on 2026-09-17;
# see the ticket's own description). See
# swarmforge/scripts/test/test_check_closed_ticket_subject.sh.
#
# Usage: check_closed_ticket_subject.sh [commit-message-file]
#   Reads the subject (first line) from the message file. Silent on main -
#   the coordinator's bookkeeping and QA's land commits legitimately name
#   closing tickets there, and the land step never attributes main's own
#   history. An unreadable origin/main warns on stderr and commits
#   (fail-open, the same posture land_step_lib.bb's closed-on-main? takes:
#   nil is never "closed").
#
# BL-897: the two regexes below are the shell mirror of
# pipeline_stage_lib.bb's ticket-id-pattern and land_step_lib.bb's
# leading-ticket-id-pattern - the two literals are asserted to agree by
# this guard's own shell test, so a change to either side that drifts the
# other is a red test, not a silent divergence.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

MSG_FILE="${1:-}"
if [[ -z "$MSG_FILE" || ! -r "$MSG_FILE" ]]; then
  # Pre-commit time (no message yet) or nothing to read: defer.
  exit 0
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
if [[ "$BRANCH" == "main" ]]; then
  exit 0
fi

SUBJECT="$(head -n1 "$MSG_FILE")"

# known-ticket-prefixes (pipeline_stage_lib.bb): BL, GH.
TICKET_PREFIXES="BL|GH"

# All named ids, de-duplicated, in order of first appearance - mirrors
# extract-ticket-ids.
named_ids=()
while IFS= read -r hit; do
  [[ -n "$hit" ]] || continue
  id="$(printf '%s' "$hit" | tr '[:lower:]' '[:upper:]' | sed -E 's/^([A-Z]+)-?([0-9]+)$/\1-\2/')"
  already=0
  for existing in ${named_ids[@]+"${named_ids[@]}"}; do
    [[ "$existing" == "$id" ]] && { already=1; break; }
  done
  [[ "$already" -eq 0 ]] && named_ids+=("$id")
done < <(printf '%s' "$SUBJECT" | grep -oiE "\\b(${TICKET_PREFIXES})-?[0-9]+\\b" || true)

if [[ ${#named_ids[@]} -eq 0 ]]; then
  # Untagged subject: nothing to attribute.
  exit 0
fi

# The leading id, if the subject's own structure positions one at the very
# start (an optional close/promote/approve verb allowed first - mirrors
# leading-ticket-id-pattern's leading-verb-prefixes).
leading_id=""
if [[ "$SUBJECT" =~ ^[[:space:]]*(([Cc][Ll][Oo][Ss][Ee]|[Pp][Rr][Oo][Mm][Oo][Tt][Ee]|[Aa][Pp][Pp][Rr][Oo][Vv][Ee])[[:space:]]+)?(([Bb][Ll]|[Gg][Hh])-?[0-9]+) ]]; then
  leading_id="$(printf '%s' "${BASH_REMATCH[3]}" | tr '[:lower:]' '[:upper:]' | sed -E 's/^([A-Z]+)-?([0-9]+)$/\1-\2/')"
fi

ambiguous=0
if [[ ${#named_ids[@]} -gt 1 && -z "$leading_id" ]]; then
  ambiguous=1
fi

if [[ "$ambiguous" -eq 1 ]]; then
  echo "Error: commit subject names several ticket ids (${named_ids[*]}) and leads with none - the land step reads this AMBIGUOUS and every named id rides as an owner (BL-1544)." >&2
  echo "Commit rejected: lead the subject with the open ticket that owns this work, e.g. \"${named_ids[0]}: ...\"." >&2
  exit 1
fi

# subject-attribution's :else branch: a single named id resolves to that
# id even with no leading structure; a leading id (when several are named)
# resolves to just the leading one.
if [[ -n "$leading_id" ]]; then
  ticket_id="$leading_id"
else
  ticket_id="${named_ids[0]}"
fi

LS_TREE_OUT="$(git ls-tree -r --name-only origin/main -- backlog/ 2>/dev/null)"
if [[ $? -ne 0 ]]; then
  echo "check_closed_ticket_subject: WARNING - could not read origin/main's backlog/ tree; not checking $ticket_id." >&2
  exit 0
fi

folders=()
while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  base="$(basename "$path")"
  if [[ "$base" =~ ^${ticket_id}(-.*)?\.ya?ml$ ]]; then
    case "$path" in
      backlog/paused/*) folders+=("paused") ;;
      backlog/active/*) folders+=("active") ;;
      backlog/done/*)   folders+=("done") ;;
    esac
  fi
done <<<"$LS_TREE_OUT"

if [[ ${#folders[@]} -eq 0 ]]; then
  echo "Error: commit subject leads with $ticket_id, which has no ticket file anywhere on origin/main - the land step reads this unreadable and fails closed (BL-1481)." >&2
  echo "Commit rejected: use a ticket id with a file on origin/main, or an untagged subject." >&2
  exit 1
fi

all_done=1
for folder in "${folders[@]}"; do
  [[ "$folder" == "done" ]] || { all_done=0; break; }
done

if [[ "$all_done" -eq 1 ]]; then
  echo "Error: commit subject leads with $ticket_id, which is closed on origin/main (filed under backlog/done/ and no other folder there) - the land step refuses a path whose every owner is closed (BL-1546)." >&2
  echo "Commit rejected: lead with the open ticket that owns this work, or use an untagged subject." >&2
  exit 1
fi

exit 0
