#!/usr/bin/env bash
# Deprecated alias — use start_cursor_bridge.sh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/start_cursor_bridge.sh" "$@"
