#!/bin/bash

# Remote bounce trigger: write a sentinel file to trigger bounce commands from a distance
# Usage: remote_bounce.sh <target-path> <swarm|extension|all>

set -euo pipefail

if [ $# -lt 2 ]; then
  cat >&2 <<'EOF'
usage: remote_bounce.sh <target-path> <bounce-type>

Writes a sentinel file to trigger a bounce command remotely.

Arguments:
  <target-path>   Path to the SwarmForge target repo
  <bounce-type>   Type of bounce: swarm, extension, or all

Examples:
  remote_bounce.sh /path/to/target swarm
  remote_bounce.sh /path/to/target extension
  remote_bounce.sh /path/to/target all
EOF
  exit 1
fi

TARGET_PATH="$1"
BOUNCE_TYPE="$2"

# Validate bounce type
case "$BOUNCE_TYPE" in
  swarm|extension|all)
    ;;
  *)
    echo "error: invalid bounce type: $BOUNCE_TYPE" >&2
    echo "valid types: swarm, extension, all" >&2
    exit 1
    ;;
esac

# Ensure target path exists
if [ ! -d "$TARGET_PATH" ]; then
  echo "error: target path does not exist: $TARGET_PATH" >&2
  exit 1
fi

# Ensure .swarmforge directory exists
SWARMFORGE_DIR="$TARGET_PATH/.swarmforge"
if [ ! -d "$SWARMFORGE_DIR" ]; then
  echo "error: .swarmforge directory not found: $SWARMFORGE_DIR" >&2
  exit 1
fi

# Write sentinel file atomically (temp file + rename)
BOUNCE_FILE="$SWARMFORGE_DIR/bounce"
BOUNCE_TMP="$SWARMFORGE_DIR/.bounce.tmp.$$"

# Clean up temp file on exit
trap "rm -f '$BOUNCE_TMP'" EXIT

# Write bounce type to temp file
echo "$BOUNCE_TYPE" > "$BOUNCE_TMP"

# Atomically rename to final location
mv "$BOUNCE_TMP" "$BOUNCE_FILE"

echo "Bounce trigger sent: $BOUNCE_TYPE"
