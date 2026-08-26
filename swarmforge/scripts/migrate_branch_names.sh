#!/usr/bin/env bash
# BL-106: one-time migration - renames each role worktree's branch to the
# unified <swarm_name>/<role> namespace (git branch -m: a ref rename only,
# no history or content change), then prunes stale duplicate role branches
# from the old mixed schemes (swarmforge-<role>, swarm/<role>) that are
# fully merged into the new branch. An unmerged duplicate is left in place
# and reported, never deleted.
#
# Usage: migrate_branch_names.sh <repo-root> <swarm_name>
#
# Reads .swarmforge/roles.tsv for the role -> worktree-path mapping (the
# same canonical source every other role/queue script already uses); the
# master/coordinator+specifier row has no dedicated worktree branch to
# rename and is skipped.
#
# Rehearse on a scratch clone before running against a live swarm's repo
# (BL-106 non-behavioral gate) - see test_migrate_branch_names.sh.

set -euo pipefail

REPO_ROOT="${1:?Usage: migrate_branch_names.sh <repo-root> <swarm_name>}"
SWARM_NAME="${2:?Usage: migrate_branch_names.sh <repo-root> <swarm_name>}"
ROLES_TSV="$REPO_ROOT/.swarmforge/roles.tsv"

[[ -f "$ROLES_TSV" ]] || { echo "Error: $ROLES_TSV not found" >&2; exit 1; }

seen_worktrees=()

while IFS=$'\t' read -r role worktree_name worktree_path _session _display _agent _receive_mode; do
  [[ -z "${role:-}" ]] && continue
  [[ "$worktree_name" == "master" ]] && continue

  # Multiple roles can share one worktree (e.g. coordinator+specifier on
  # master, already skipped above) - guard against processing the SAME
  # physical worktree's branch twice under two different role names.
  if printf '%s\n' "${seen_worktrees[@]:-}" | grep -qx "$worktree_path"; then
    continue
  fi
  seen_worktrees+=("$worktree_path")

  new_branch="${SWARM_NAME}/${role}"
  current_branch="$(git -C "$worktree_path" rev-parse --abbrev-ref HEAD)"

  if [[ "$current_branch" == "$new_branch" ]]; then
    echo "OK: $role already on $new_branch"
  else
    echo "RENAME: $role: $current_branch -> $new_branch"
    git -C "$REPO_ROOT" branch -m "$current_branch" "$new_branch"
  fi

  # Prune stale duplicates left over from the two prior mixed schemes -
  # only ever the ones that are NOT the branch just renamed/confirmed, and
  # only when fully merged into it (never discard unmerged work).
  for candidate in "swarmforge-${role}" "swarm/${role}"; do
    [[ "$candidate" == "$current_branch" || "$candidate" == "$new_branch" ]] && continue
    if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$candidate"; then
      if git -C "$REPO_ROOT" merge-base --is-ancestor "$candidate" "$new_branch"; then
        echo "PRUNE: deleting fully-merged duplicate branch $candidate"
        git -C "$REPO_ROOT" branch -d "$candidate"
      else
        echo "SKIP-PRUNE: $candidate is NOT fully merged into $new_branch - left in place"
      fi
    fi
  done
done < "$ROLES_TSV"

echo "ALL DONE"
