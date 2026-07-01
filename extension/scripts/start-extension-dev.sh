#!/usr/bin/env bash
# Robust extension dev-host bounce (BL-058). The orchestration lives in
# start-extension-dev.js; this wrapper only preserves the entry point.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/start-extension-dev.js" "$@"
