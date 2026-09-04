#!/usr/bin/env bash
# open_swarm_spy_router.sh — convenience entry under scripts/.
# See swarmforge/scripts/open_swarm_spy_router.sh for the real implementation.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/../swarmforge/scripts/open_swarm_spy_router.sh" "$@"
