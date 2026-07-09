#!/usr/bin/env bash
# attach-swarm.sh — attach to a live SwarmForge agent tmux session.
#
# Usage:
#   ./attach-swarm.sh [role] [target-path]
#
# See swarmforge/scripts/swarm_attach.sh for details.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/swarmforge/scripts/swarm_attach.sh" "$@"
