#!/usr/bin/env bash
# Abandon a stale/divergent expedited run, checkpoint the current main-worktree
# WIP, then restart the ticket from that checkpoint.
#
# Usage:
#   reexpedite_from_wip.sh [<project-root>] <BL-id> [expedite options...]
#
# The checkpoint deliberately includes tracked and untracked project work so the
# fresh worktree cannot silently start behind the operator's current source.
# Runtime/build trees are excluded. A clean checkout produces no empty commit.
#
# Env:
#   REEXPEDITE_DRY_RUN=1       print the plan without changing anything
#   REEXPEDITE_SKIP_PREFLIGHT=1  forwarded as EXPEDITE_SKIP_PREFLIGHT=1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

usage() {
  echo "Usage: reexpedite_from_wip.sh [<project-root>] <BL-id> [expedite options...]" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
if [[ "$1" =~ ^BL-[0-9]+$ ]]; then
  ROOT="$DEFAULT_ROOT"
  TICKET="${1^^}"
  shift
else
  [[ $# -ge 2 ]] || usage
  ROOT="$(cd "$1" && pwd)"
  TICKET="${2^^}"
  shift 2
fi
[[ "$TICKET" =~ ^BL-[0-9]+$ ]] || usage

WORKTREE="$ROOT/.worktrees/expedite-$TICKET"
BRANCH="expedite/$TICKET"
RUN_DIR="$ROOT/.swarmforge/expedite/$TICKET"
LOCK="$ROOT/.swarmforge/operator/expedite-bridge.lock"
EXPEDITE="$ROOT/swarmforge/scripts/expedite_with_progress.sh"
DRY_RUN="${REEXPEDITE_DRY_RUN:-0}"

[[ -d "$ROOT/.git" || -f "$ROOT/.git" ]] || {
  echo "reexpedite: not a git worktree: $ROOT" >&2
  exit 1
}
[[ -x "$EXPEDITE" || "$DRY_RUN" == "1" ]] || {
  echo "reexpedite: missing executable: $EXPEDITE" >&2
  exit 1
}

current_branch="$(git -C "$ROOT" branch --show-current)"
[[ "$current_branch" == "main" ]] || {
  echo "reexpedite: refusing checkpoint outside main (current: ${current_branch:-detached})" >&2
  exit 1
}

log() { printf 'reexpedite: %s\n' "$*"; }

if [[ "$DRY_RUN" == "1" ]]; then
  log "DRYRUN stop active expedite for $TICKET"
  log "DRYRUN remove worktree $WORKTREE and branch $BRANCH"
  log "DRYRUN checkpoint current WIP on main (excluding runtime/build trees)"
  log "DRYRUN clear $RUN_DIR and stale lock"
  log "DRYRUN relaunch $TICKET via $EXPEDITE $*"
  exit 0
fi

descendants_of() {
  local parent="$1" child
  while read -r child; do
    [[ -n "$child" ]] || continue
    descendants_of "$child"
    printf '%s\n' "$child"
  done < <(pgrep -P "$parent" 2>/dev/null || true)
}

mapfile -t expedite_pids < <(
  pgrep -f "expedite_cli\\.bb ${ROOT//\//\\/} ${TICKET}( |$)" 2>/dev/null || true
)
if ((${#expedite_pids[@]} > 0)); then
  log "stopping active $TICKET expedite (pid ${expedite_pids[*]})"
  for pid in "${expedite_pids[@]}"; do
    mapfile -t children < <(descendants_of "$pid")
    ((${#children[@]} == 0)) || kill -TERM "${children[@]}" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
  done
  for _ in {1..20}; do
    alive=0
    for pid in "${expedite_pids[@]}"; do
      kill -0 "$pid" 2>/dev/null && alive=1
    done
    ((alive == 0)) && break
    sleep 0.25
  done
  for pid in "${expedite_pids[@]}"; do
    kill -KILL "$pid" 2>/dev/null || true
  done
fi

if [[ -e "$WORKTREE" ]]; then
  log "removing abandoned worktree $WORKTREE"
  git -C "$ROOT" worktree remove --force "$WORKTREE"
fi
git -C "$ROOT" worktree prune
if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  log "deleting abandoned branch $BRANCH"
  git -C "$ROOT" branch -D "$BRANCH"
fi

rm -rf -- "$RUN_DIR"
if [[ -f "$LOCK" ]] && grep -q "\"ticket\"[[:space:]]*:[[:space:]]*\"$TICKET\"" "$LOCK"; then
  rm -f -- "$LOCK"
fi

exclude_file="$(mktemp)"
trap 'rm -f -- "$exclude_file"' EXIT
cat > "$exclude_file" <<'EOF'
/node_modules/
/.worktrees/
/.swarmforge/
/extension/node_modules/
/extension/out/
/extension/.stryker-tmp/
EOF
# An excludes file keeps untracked runtime trees out without naming ignored
# paths explicitly to `git add` (which Git rejects even when they are negated).
git -C "$ROOT" -c core.excludesFile="$exclude_file" add -A
rm -f -- "$exclude_file"
trap - EXIT

if git -C "$ROOT" diff --cached --quiet; then
  log "main WIP is already checkpointed"
else
  git -C "$ROOT" commit -m "Checkpoint $TICKET WIP before re-expedite"
  log "checkpoint committed at $(git -C "$ROOT" rev-parse --short HEAD)"
fi

log "relaunching $TICKET from $(git -C "$ROOT" rev-parse --short HEAD)"
if [[ "${REEXPEDITE_SKIP_PREFLIGHT:-0}" == "1" ]]; then
  export EXPEDITE_SKIP_PREFLIGHT=1
fi
exec "$EXPEDITE" "$ROOT" "$TICKET" "$@"
