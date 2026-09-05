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
# BL-1341 adds the SECOND direction, against MERGE_HEAD. The diff above is
# structurally blind to a path that exists only on the INCOMING branch: HEAD
# never had it, so dropping it in a hand resolution leaves that diff empty
# and the merge sails through. On `main` the incoming branch is origin/main -
# the branch QA pushes approved work onto - so the blind direction was the
# one that loses reviewed work, and the guarded one protected the local tip
# that may be hours stale. Merge `b71c941a19` (2026-09-02) went through it
# with 9 of BL-1330's landed paths: zero deletions against parent 1, nine
# against parent 2.
#
# ONE refusal and ONE exemption model cover both directions, deliberately.
# A path dropped from both sides is one finding, not two, and each finding
# says which side the path came from so a resolver can tell an intended drop
# from an accident. This is NOT split into a second script: the failure mode
# is a guard family whose members each look complete alone while their union
# leaves a hole, and a fourth sibling would make that shape worse.
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

MERGE_HEAD_SHA="$(cat "$MERGE_HEAD_PATH" 2>/dev/null | head -1 | tr -d '[:space:]')"

# Both directions, collected into one list. `side_of` remembers where each
# path came from; a path dropped from BOTH sides is recorded once, with both
# sides named, rather than reported twice (BL-1242 scenario 04's discipline,
# carried across the new direction).
deleted_paths=()
declare -A side_of=()

collect_deletions() {
  local against="$1" side="$2" status path
  [[ -n "$against" ]] || return 0
  # BL-1403: rename detection ON (git's default similarity threshold) - a
  # moved path (e.g. a root-drain archiving `git mv backlog/INTAKE-x.md
  # backlog/archive/INTAKE-x.md` plus an appended footer) reports as
  # `R<NNN>\t<old>\t<new>`, never a bare `D`, so the `status == "D"` check
  # below already excludes it - its content survives at the new path, so it
  # is not a deletion at all. Only a status-only rename (name kept, content
  # replaced) would EVER fall below the threshold back to D+A, which is
  # correctly still reported.
  while IFS=$'\t' read -r status path; do
    [[ -n "$status" && -n "$path" ]] || continue
    [[ "$status" == "D" ]] || continue
    is_ticket_yaml_path "$path" && continue
    if [[ -n "${side_of[$path]:-}" ]]; then
      # Already seen from the other side - one finding, both sides named.
      side_of["$path"]="${side_of[$path]} and $side"
      continue
    fi
    side_of["$path"]="$side"
    deleted_paths+=("$path")
  done < <(git diff --name-status -M "$against")
}

collect_deletions HEAD "this branch"
collect_deletions "$MERGE_HEAD_SHA" "the incoming branch"

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
#
# BL-1341: attribution is asked of whichever side actually carries the path.
# Asking HEAD about an incoming-only path returns nothing, which would report
# it as "(unattributed)" and lose the very ticket id the exemption matches
# against - so the refusal would be unexemptable by naming the right ticket.
# BL-1403: id and commit are now resolved TOGETHER, from whichever side
# actually names a ticket - HEAD's own subject yielding NO id (present but
# unticketed, e.g. a raw intake's "file a question" commit) falls through to
# MERGE_HEAD exactly like an EMPTY subject already did, so the commit
# reported always matches the side the id came from. Prints
# "commit<TAB>id" - commit FIRST, id LAST: bash's `read` silently swallows a
# LEADING empty field even with IFS set to a single explicit tab (measured
# while authoring this: `printf '%s\t%s\n' "" x | { IFS=$'\t' read a b; }`
# gives a=x, b="", not a="", b=x) but correctly preserves a TRAILING one, so
# id - the field that is legitimately empty when neither side attributes -
# must never be first.
attribution_for_path() {
  local path="$1" subject commit
  commit="$(git log -1 --format=%h HEAD -- "$path" 2>/dev/null || true)"
  subject="$(git log -1 --format=%s HEAD -- "$path" 2>/dev/null || true)"
  if [[ "$subject" =~ ([A-Za-z]+-[0-9]+) ]]; then
    printf '%s\t%s\n' "$commit" "${BASH_REMATCH[1]}"
    return
  fi
  if [[ -n "$MERGE_HEAD_SHA" ]]; then
    local m_commit m_subject
    m_commit="$(git log -1 --format=%h "$MERGE_HEAD_SHA" -- "$path" 2>/dev/null || true)"
    m_subject="$(git log -1 --format=%s "$MERGE_HEAD_SHA" -- "$path" 2>/dev/null || true)"
    if [[ "$m_subject" =~ ([A-Za-z]+-[0-9]+) ]]; then
      printf '%s\t%s\n' "$m_commit" "${BASH_REMATCH[1]}"
      return
    fi
    # Neither side names a ticket - still report a commit for diagnostics,
    # preferring HEAD's (matches the pre-BL-1403 default) when it exists.
    if [[ -z "$commit" ]]; then
      commit="$m_commit"
    fi
  fi
  printf '%s\t%s\n' "$commit" ""
}

violations=()
for path in "${deleted_paths[@]}"; do
  id=""
  commit=""
  while IFS=$'\t' read -r attr_commit attr_id; do
    id="$attr_id"
    commit="$attr_commit"
  done < <(attribution_for_path "$path")
  if [[ -n "$id" ]] && printf '%s' "$message" | grep -qiE "\\b${id}\\b"; then
    continue
  fi
  violations+=("${id:-(unattributed)}"$'\t'"$path"$'\t'"${commit:-unknown}"$'\t'"${side_of[$path]:-this branch}")
done

if [[ ${#violations[@]} -eq 0 ]]; then
  exit 0
fi

for entry in "${violations[@]}"; do
  IFS=$'\t' read -r id path commit side <<<"$entry"
  echo "Error: merge deletes '$path' (${id}, introduced at ${commit} on ${side}), not named in the commit message." >&2
done
echo "Commit rejected: name the affected ticket id(s) in the commit message to confirm a deliberate removal, or re-merge the branch commit(s) that introduced these paths first." >&2
exit 1
