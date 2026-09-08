#!/usr/bin/env bash
# BL-1471: a bounce revert must touch only the bounced ticket's own paths,
# and a bounce for an OMISSION (nothing the parcel added was wrong) must
# revert nothing at all.
#
# The 2026-09-07 incident: QA bounced BL-1348 for a missing scenario
# (class spec-gap - an omission) and ran `git revert -m 1 <review-merge>`,
# the BL-490/BL-495 convention's own route. A merge revert reverses the
# WHOLE combined diff relative to the branch's prior tip, so it took back
# out ruling B's implementation, its tests, both vitest configs, BL-1348's
# own evidence, and two OTHER tickets' evidence files (BL-940, BL-1468)
# that had arrived through the same merged history. Only the coder
# restoring them on merge stopped a silent regression from reaching every
# worktree via QA's merge-up broadcast. Nothing the parcel added was wrong,
# so nothing should have been reverted at all.
#
# Usage: check_bounce_revert_scope.sh [commit-message-file]
#
#   Detecting "is this commit a revert" is a MESSAGE question - unlike a
#   merge (MERGE_HEAD is a file on disk the moment the merge starts) a
#   revert leaves no on-disk marker for a clean, non-conflicting apply
#   (confirmed empirically against this repo's git: neither pre-commit nor
#   commit-msg fires for `git revert -m 1 <merge>` when it applies clean -
#   only prepare-commit-msg and post-commit do). So, same posture as
#   check_ticket_deletion.sh's own message-dependent half: a call with no
#   message-file argument (the pre-commit chain's own call, since git does
#   not have the message yet - githooks(5)) can only ever defer, never
#   refuse - it always exits 0. The commit-msg hook below passes its own
#   "$1", which DOES carry the finalized message whenever pre-commit fires
#   for the eventual real commit (a CONFLICTED revert resolved by hand with
#   a plain `git commit`, or a `git revert -n` staged and committed
#   manually). A clean, non-conflicting merge-revert's OWN auto-commit is a
#   known residual this guard cannot reach in this git version - flagged to
#   the specifier as a spec-gap note alongside this ticket's evidence
#   (git-revert-of-a-merge does not run either hook in this environment;
#   only prepare-commit-msg/post-commit do), not something this ticket's
#   scope extends to fixing.
#
# Attribution reuses check_merge_deletion.sh's own walk: the ticket id in
# the subject of the commit on HEAD's own history that most recently
# touched a path. The bounce store reader reuses is_qa_ancestor.sh's
# shared-root resolution (git-common-dir's parent - BL-1339/BL-1470) and
# its no-jq, grep/sed JSON field extraction (stock bash 3.2 - BL-801).

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

MSG_FILE="${1:-}"

if [[ -z "$MSG_FILE" || ! -r "$MSG_FILE" ]]; then
  # Pre-commit time: the commit message does not exist yet, so this guard
  # cannot even tell whether a revert is in progress. Defer.
  exit 0
fi

SUBJECT="$(head -n1 "$MSG_FILE" || true)"
case "$SUBJECT" in
  'Revert "'*) ;;
  *)
    # Not a revert - nothing for this guard to judge (scenario 04).
    exit 0
    ;;
esac

REVERTED_TOKEN=""
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" =~ ^This\ reverts\ commit\ ([0-9a-fA-F]{4,40}) ]]; then
    REVERTED_TOKEN="${BASH_REMATCH[1]}"
    break
  fi
done < "$MSG_FILE"

FULL_REVERTED=""
if [[ -n "$REVERTED_TOKEN" ]]; then
  FULL_REVERTED="$(git rev-parse --verify -q "${REVERTED_TOKEN}^{commit}" 2>/dev/null || true)"
fi

# ── the shared bounce store root (BL-1339/BL-1470's resolution: the
#    caller may be a linked worktree, but the store lives at the shared
#    target root, git-common-dir's parent) ──────────────────────────────
STORE_ROOT="$(git rev-parse --git-common-dir 2>/dev/null || true)"
if [[ -n "$STORE_ROOT" ]]; then
  STORE_ROOT="$(cd "$(dirname "$STORE_ROOT")" 2>/dev/null && pwd -P || true)"
fi
if [[ -z "$STORE_ROOT" ]]; then
  STORE_ROOT="$REPO_ROOT"
fi
BOUNCES_DIR="$STORE_ROOT/.swarmforge/bounces"

# One JSON string field's value off a single JSONL line - no jq (BL-801).
json_field() {
  local field="$1" line="$2"
  case "$line" in
    *"\"${field}\":\""*)
      printf '%s' "$line" | sed -E "s/.*\"${field}\":\"([^\"]*)\".*/\1/"
      ;;
    *)
      printf ''
      ;;
  esac
}

bounce_jsonl_files() {
  local f
  if [[ -d "$BOUNCES_DIR" ]]; then
    for f in "$BOUNCES_DIR"/*.jsonl; do
      [[ -e "$f" ]] || continue
      printf '%s\n' "$f"
    done
  fi
}

# The ticket named by the single bounce record (never a correction) with
# the latest `at` across the whole store - the fallback identification
# when the reverted merge's own second-parent history names no ticket.
latest_bounce_ticket_overall() {
  local best_at="" best_ticket="" f line at ticket
  while IFS= read -r f; do
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ -n "$line" ]] || continue
      case "$line" in *'"kind":"bounce-correction"'*) continue ;; esac
      ticket="$(json_field ticket "$line")"
      [[ -n "$ticket" ]] || continue
      at="$(json_field at "$line")"
      if [[ -z "$best_at" || "$at" > "$best_at" ]]; then
        best_at="$at"
        best_ticket="$ticket"
      fi
    done < "$f"
  done < <(bounce_jsonl_files)
  printf '%s\n' "$best_ticket"
}

# The failureClass of TICKET's latest (by `at`) genuine bounce record -
# never a correction record, which carries no failureClass at all.
latest_bounce_class_for_ticket() {
  local ticket="$1" best_at="" best_class="" f line at class line_ticket
  while IFS= read -r f; do
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ -n "$line" ]] || continue
      case "$line" in *'"kind":"bounce-correction"'*) continue ;; esac
      line_ticket="$(json_field ticket "$line")"
      [[ "$line_ticket" == "$ticket" ]] || continue
      at="$(json_field at "$line")"
      class="$(json_field failureClass "$line")"
      if [[ -z "$best_at" || "$at" > "$best_at" ]]; then
        best_at="$at"
        best_class="$class"
      fi
    done < "$f"
  done < <(bounce_jsonl_files)
  printf '%s\n' "$best_class"
}

# The bounce record (never a correction) whose own `commit` is an ancestor
# of the reverted merge's second parent, latest by `at` - the store's
# `commit` is the PARCEL commit QA actually reviewed and bounced, which is
# necessarily somewhere in the incoming branch's own history. This is the
# authoritative match: a merge routinely carries more than one ticket's
# commits (BL-1348's own incident did), so "whichever ticket id appears in
# the newest subject" is not reliable - the bounce store says which ticket
# was actually bounced, the merge history only says what it carried.
bounce_ticket_ancestor_of() {
  local tip="$1" best_at="" best_ticket="" f line at ticket commit_token full_commit
  [[ -n "$tip" ]] || return 0
  while IFS= read -r f; do
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ -n "$line" ]] || continue
      case "$line" in *'"kind":"bounce-correction"'*) continue ;; esac
      ticket="$(json_field ticket "$line")"
      [[ -n "$ticket" ]] || continue
      commit_token="$(json_field commit "$line")"
      [[ -n "$commit_token" ]] || continue
      full_commit="$(git rev-parse --verify -q "${commit_token}^{commit}" 2>/dev/null || true)"
      [[ -n "$full_commit" ]] || continue
      git merge-base --is-ancestor "$full_commit" "$tip" 2>/dev/null || continue
      at="$(json_field at "$line")"
      if [[ -z "$best_at" || "$at" > "$best_at" ]]; then
        best_at="$at"
        best_ticket="$ticket"
      fi
    done < "$f"
  done < <(bounce_jsonl_files)
  printf '%s\n' "$best_ticket"
}

# ── identify the bounced ticket ─────────────────────────────────────────
TICKET=""
P2=""
if [[ -n "$FULL_REVERTED" ]]; then
  read -r _self P1 P2 _rest <<<"$(git rev-list --parents -n1 "$FULL_REVERTED" 2>/dev/null || true)"
  if [[ -n "${P2:-}" ]]; then
    TICKET="$(bounce_ticket_ancestor_of "$P2")"
  fi
fi

if [[ -z "$TICKET" && -n "${P2:-}" ]]; then
  while IFS= read -r subj; do
    if [[ "$subj" =~ ([A-Za-z]+-[0-9]+) ]]; then
      TICKET="${BASH_REMATCH[1]}"
      break
    fi
  done < <(git log --format=%s "${P1}..${P2}" 2>/dev/null || true)
fi

if [[ -z "$TICKET" ]]; then
  TICKET="$(latest_bounce_ticket_overall)"
fi

if [[ -z "$TICKET" ]]; then
  # No way to identify which ticket this revert is for - nothing to check
  # against. Should not happen for a real bounce revert (a bounce store
  # record always exists); never block on an unrelated revert this guard
  # cannot attribute.
  exit 0
fi

# ── omission-class gate (scenario 03): categorical, never scope-checked -
#    an omission bounce names nothing added wrongly, so nothing is due to
#    be reverted at all. The two-member set mirrors
#    extension/src/quality/qaBounce.ts's KNOWN_FAILURE_CLASSES omission
#    subset (spec-gap, invariant-unencoded) - a language boundary this
#    shell guard cannot import across (BL-897's shape). ──────────────────
CLASS="$(latest_bounce_class_for_ticket "$TICKET")"
case "$CLASS" in
  spec-gap|invariant-unencoded)
    echo "Error: revert ${FULL_REVERTED:-$REVERTED_TOKEN} is for ${TICKET}, whose latest bounce record is class '${CLASS}' - an omission bounce names nothing the parcel added wrongly, so there is nothing to revert." >&2
    echo "Commit rejected: an omission-class bounce (spec-gap, invariant-unencoded) must not be reverted; leave the reviewed content in place and fix the omission going forward instead." >&2
    exit 1
    ;;
esac

# ── scope gate (scenarios 01/02): every path this revert touches must
#    attribute to TICKET, never to another ticket. Attribution reuses
#    check_merge_deletion.sh's own walk: the ticket id in the subject of
#    the commit on HEAD's own history that most recently touched the
#    path. An unattributed path (no ticket-shaped subject) is not
#    evidence of a violation and is left alone. ─────────────────────────
violations=()
while IFS=$'\t' read -r status path; do
  [[ -n "$status" && -n "$path" ]] || continue
  subject="$(git log -1 --format=%s HEAD -- "$path" 2>/dev/null || true)"
  if [[ "$subject" =~ ([A-Za-z]+-[0-9]+) ]]; then
    attributed="${BASH_REMATCH[1]}"
    if [[ "$attributed" != "$TICKET" ]]; then
      violations+=("$attributed"$'\t'"$path")
    fi
  fi
done < <(git diff --cached --name-status -M HEAD 2>/dev/null || true)

if [[ ${#violations[@]} -eq 0 ]]; then
  exit 0
fi

for entry in "${violations[@]}"; do
  IFS=$'\t' read -r id path <<<"$entry"
  echo "Error: revert touches '${path}', attributed to ${id}, not the bounced ticket ${TICKET}." >&2
done
echo "Commit rejected: a bounce revert must touch only ${TICKET}'s own paths; restore the other ticket(s)' content before committing (BL-490/BL-495's core is unchanged - a scoped revert is still due)." >&2
exit 1
