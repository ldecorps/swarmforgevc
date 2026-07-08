#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
unset SWARMFORGE_CONFIG
bash "$SCRIPT_DIR/test_alternate_runtime_launch.sh"
