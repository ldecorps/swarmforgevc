#!/usr/bin/env bash
# Reset role worktrees after a swarm run.
#
# Default (soft): drop sync drift, finish junk deletions, remove agent litter.
# Does not move branch tips.
#
# --align-main (hard): for every role worktree, keep the current agent branch
# name but reset its tip onto main (origin/main if available) and git clean -fd
# so every role starts aligned with main. Does not force-push remotes.
#
# Usage:
#   reset_worktrees.sh [repo-root]
#   reset_worktrees.sh --align-main [repo-root]
set -euo pipefail

ALIGN_MAIN=0
ROOT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --align-main)
      ALIGN_MAIN=1
      shift
      ;;
    -h|--help)
      sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "ERROR: unknown option: $1" >&2
      echo "Usage: reset_worktrees.sh [--align-main] [repo-root]" >&2
      exit 2
      ;;
    *)
      if [[ -n "$ROOT" ]]; then
        echo "ERROR: unexpected extra argument: $1" >&2
        exit 2
      fi
      ROOT="$1"
      shift
      ;;
  esac
done

ROOT="$(cd "${ROOT:-.}" && pwd)"

resolve_main_ref() {
  # Prefer a freshly fetched origin/main; fall back to local main.
  if git -C "$ROOT" rev-parse --verify -q origin/main >/dev/null 2>&1; then
    git -C "$ROOT" fetch --quiet origin main 2>/dev/null || true
    if git -C "$ROOT" rev-parse --verify -q origin/main >/dev/null 2>&1; then
      git -C "$ROOT" rev-parse origin/main
      return
    fi
  fi
  git -C "$ROOT" rev-parse main
}

align_one() {
  local wt="$1"
  local main_ref="$2"
  local name
  name="$(basename "$wt")"
  [[ -e "$wt/.git" ]] || return 0
  [[ "$name" == "completed" ]] && return 0

  cd "$wt"
  git merge --abort >/dev/null 2>&1 || true
  git rebase --abort >/dev/null 2>&1 || true
  git cherry-pick --abort >/dev/null 2>&1 || true

  # Keep the role's branch name; move its tip onto main.
  git reset --hard "$main_ref"
  git clean -fd

  local br head
  br="$(git branch --show-current 2>/dev/null || echo '?')"
  head="$(git rev-parse --short HEAD)"
  echo "$name: aligned $br -> $head (main)"
}

reset_one_soft() {
  local wt="$1"
  local name
  name="$(basename "$wt")"
  [[ -e "$wt/.git" ]] || return 0
  [[ "$name" == "completed" ]] && return 0

  cd "$wt"

  # Agent litter
  rm -rf node_modules 2>/dev/null || true
  find . -maxdepth 2 \( -name '*Updated*' -o -name 'File:*' \) -exec rm -rf {} + 2>/dev/null || true

  # Drop script sync drift (worktrees get copies on launch; agents edit in place)
  git checkout -- swarmforge/scripts/ 2>/dev/null || true

  # Finish staged junk deletions from bad merges
  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    git add -u 2>/dev/null || true
    if ! git diff --cached --quiet 2>/dev/null; then
      git commit -m "chore: finish junk artifact removal after swarm cleanup." \
        2>/dev/null && echo "$name: committed junk cleanup" || echo "$name: commit skipped"
    fi
  fi

  # Untracked profile/script copies — main is canonical
  rm -rf swarmforge/profiles 2>/dev/null || true
  git clean -fd -- swarmforge/scripts/agent_runtime.sh \
    swarmforge/scripts/agent_runtime_cli.bb \
    swarmforge/scripts/connected_agent_probe.sh \
    swarmforge/scripts/copilot_trust_folders.sh \
    swarmforge/scripts/route_backlog_to_coder.sh \
    swarmforge/scripts/swarm_attach.sh 2>/dev/null || true

  local st
  st="$(git status -sb | head -1)"
  echo "$name: $st"
}

shopt -s nullglob
if [[ "$ALIGN_MAIN" -eq 1 ]]; then
  MAIN_REF="$(resolve_main_ref)"
  echo "Aligning role worktrees onto $(git -C "$ROOT" rev-parse --short "$MAIN_REF") ..."
  for wt in "$ROOT/.worktrees"/*; do
    align_one "$wt" "$MAIN_REF"
  done
  echo "Worktree align-to-main complete."
else
  for wt in "$ROOT/.worktrees"/*; do
    reset_one_soft "$wt"
  done
  echo "Worktree reset complete."
fi
shopt -u nullglob
