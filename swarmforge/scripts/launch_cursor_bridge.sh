#!/usr/bin/env bash
# Deprecated alias — use start_cursor_bridge.sh.
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
launch_cursor_bridge.sh — lifecycle start entry point.

Stop: stop_ancillary_services.sh / ./stop-swarm.sh (or ./swarm-kill for pipeline-only)

Usage: see header comments above.
EOF
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/start_cursor_bridge.sh" "$@"
