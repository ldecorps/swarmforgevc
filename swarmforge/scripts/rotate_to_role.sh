#!/usr/bin/env bash
# BL-518: mono-router rotation. Thin wrapper so the resident agent rotates
# with the same `./<script>.sh` idiom every other handoff helper uses.
# Usage: rotate_to_role.sh <role>
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if the resident is stranded for >10m
if [ $(date +%s) -gt $(date -d "$HOME_ROLE" +%s) + 600 ]; then
  # Re-dispatch work or rotate to the home role
  if [ -n "$ROTATE_TO" ]; then
    ROTATE_BIN="${SWARMFORGE_ROTATE_TO_ROLE:-$DIR/rotate_to_role.sh}"
    SWARMFORGE_ROTATION_REASON="route work" exec "$ROTATE_BIN" "$ROTATE_TO"
  else
    ROTATE_BIN="${SWARMFORGE_ROTATE_TO_ROLE:-$DIR/rotate_to_role.sh}"
    SWARMFORGE_ROTATION_REASON="rotate to home" exec "$ROTATE_BIN" "coder"
  fi
else
  # Delegate to the rotate_to_role.sh script directly
  exec "$DIR/rotate_to_role.sh" "$@"
fi
