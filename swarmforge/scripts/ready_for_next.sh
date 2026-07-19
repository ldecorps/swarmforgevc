#!/usr/bin/env zsh
set -euo pipefail

# Resolve the directory this script lives in.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Move to the SwarmForge scripts root so that relative paths inside the
# Babashka ready_for_next.bb helper resolve correctly, regardless of the
# caller's current working directory.
cd "$SCRIPT_DIR"

# Delegate to the Babashka dispatcher script. Any error in bb or the
# .bb code will cause this script to exit non‑zero because of set -e.
exec bb "$SCRIPT_DIR/ready_for_next.bb" "$@"
