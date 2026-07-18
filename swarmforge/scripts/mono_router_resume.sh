#!/usr/bin/env bash
# Resume mono-router resident at the furthest role that already holds work
# for an active ticket (so a pack relaunch does not restart at coder-home).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bb "$SCRIPT_DIR/mono_router_resume.bb" "$@"
