#!/usr/bin/env bash
#
# stop-swarm.sh — stop the SwarmForge swarm for this repo (or a target path).
#
# Thin root shortcut for swarmforge/scripts/kill_all_swarm.sh, paired with
# ./start-swarm.sh. Idempotent — safe when nothing is running.
#
# Usage:
#   ./stop-swarm.sh [options] [target-path]   # defaults to this repo's root
#
# Options (forwarded to kill_all_swarm.sh):
#   --sweep-inbox
#   --reset-worktrees
#   --full                 # inbox sweep + worktree reset
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KILL_ALL="$SCRIPT_DIR/swarmforge/scripts/kill_all_swarm.sh"

OPTS=()
TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sweep-inbox|--reset-worktrees|--full)
      OPTS+=("$1")
      shift
      ;;
    -h|--help)
      cat <<'EOF'
stop-swarm.sh — stop the SwarmForge swarm for this repo (or a target path).

Usage:
  ./stop-swarm.sh [options] [target-path]   # defaults to this repo's root

Options (forwarded to kill_all_swarm.sh):
  --sweep-inbox
  --reset-worktrees
  --full                 # inbox sweep + worktree reset
EOF
      exit 0
      ;;
    -*)
      echo "ERROR: unknown option: $1" >&2
      echo "Usage: ./stop-swarm.sh [--sweep-inbox|--reset-worktrees|--full] [target-path]" >&2
      exit 2
      ;;
    *)
      if [[ -n "$TARGET" ]]; then
        echo "ERROR: unexpected extra argument: $1" >&2
        exit 2
      fi
      TARGET="$1"
      shift
      ;;
  esac
done

TARGET="${TARGET:-$SCRIPT_DIR}"
TARGET="$(cd "$TARGET" && pwd)"

exec bash "$KILL_ALL" "${OPTS[@]}" "$TARGET"
