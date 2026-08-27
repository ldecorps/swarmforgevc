#!/usr/bin/env bash
# attach-swarm.sh — attach to a live SwarmForge agent tmux session.
#
# Usage:
#   ./attach-swarm.sh [role|resident] [target-path]
#
# Mono-router packs (config rotation router): use `resident` or omit the role
# to attach the standing pipeline pane (.swarmforge/mono-router-active-role).
# Named roles (coder, specifier, …) still work but may be dormant.
#
# See swarmforge/scripts/swarm_attach.sh for details.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/swarmforge/scripts/swarm_attach.sh" "$@"
