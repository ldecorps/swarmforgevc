#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Ensure we run Babashka from the scripts directory so relative paths in
# ready_for_next_batch.bb resolve correctly regardless of the caller's CWD.
cd "$SCRIPT_DIR"

exec bb "$SCRIPT_DIR/ready_for_next_batch.bb" "$@"
