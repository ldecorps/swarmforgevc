#!/usr/bin/env bash
#
# stop-swarm.sh — stop the full SwarmForge stack for this repo.
#
# Stops ancillaries first (babysitter, operator, Telegram front desk, tunnels),
# then the swarm agents + handoffd via kill_all_swarm.sh. Idempotent.
#
# Usage:
#   ./stop-swarm.sh [options] [target-path]   # defaults to this repo's root
#
# Options (forwarded to kill_all_swarm.sh after ancillaries stop):
#   --sweep-inbox
#   --reset-worktrees
#   --full                 # inbox sweep + worktree reset
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KILL_ALL="$SCRIPT_DIR/swarmforge/scripts/kill_all_swarm.sh"
STOP_ANCILLARY="$SCRIPT_DIR/swarmforge/scripts/stop_ancillary_services.sh"

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
stop-swarm.sh — stop the full SwarmForge stack for this repo.

Stops: babysitter, operator runtime, Telegram front desk, remote tunnels,
       then swarm agent sessions and handoffd.

Usage:
  ./stop-swarm.sh [options] [target-path]   # defaults to this repo's root

Options (swarm agents / handoffd only — after ancillaries):
  --sweep-inbox
  --reset-worktrees
  --full                 # inbox sweep + worktree reset

For agents-only stop (tests / surgical): ./swarm-kill
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

bash "$STOP_ANCILLARY" "$TARGET"
if ((${#OPTS[@]})); then
  exec bash "$KILL_ALL" "${OPTS[@]}" "$TARGET"
else
  exec bash "$KILL_ALL" "$TARGET"
fi
