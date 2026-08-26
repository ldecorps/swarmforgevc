#!/usr/bin/env bash
# Deprecated alias — use start_cursor_bridge.sh.
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  _lh_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck disable=SC1091
  source "$_lh_dir/lifecycle_help_lib.sh"
  print_lifecycle_help "launch_cursor_bridge.sh" "lifecycle start entry point."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/start_cursor_bridge.sh" "$@"
