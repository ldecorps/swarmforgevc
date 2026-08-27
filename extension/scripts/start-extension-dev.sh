#!/usr/bin/env bash
# Robust extension dev-host bounce (BL-058). The orchestration lives in
# start-extension-dev.js; this wrapper only preserves the entry point.
#
# Pass --autostart to also launch the swarm unattended after activation via
# remote_bounce.sh (reads swarmforge.targetPath from .vscode/settings.json
# unless SWARMFORGE_TARGET_PATH or an explicit path is given).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/start-extension-dev.js" "$@"
