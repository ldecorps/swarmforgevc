#!/usr/bin/env bash
# Reset role worktrees after a swarm run: drop sync drift, finish junk deletions,
# remove agent litter (node_modules, copied profiles). Does not touch main checkout.
#
# Usage: reset_worktrees.sh [repo-root]
set -euo pipefail

ROOT="$(cd "${1:-.}" && pwd)"

reset_one() {
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
for wt in "$ROOT/.worktrees"/*; do
  reset_one "$wt"
done
shopt -u nullglob

echo "Worktree reset complete."
