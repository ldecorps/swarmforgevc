#!/usr/bin/env bash
# Facade CLI — callers use this instead of agent-specific tmux syntax.
#
# Usage:
#   agent_runtime.sh handoff-draft-path <agent>
#   agent_runtime.sh wake-text <agent>
#   agent_runtime.sh bootstrap-text <agent> <role> [two-pack:0|1]
#   agent_runtime.sh run-bootstrap <socket> <session> <agent> <role> <prompt-file> [two-pack:0|1]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bb "$SCRIPT_DIR/agent_runtime_cli.bb" "$@"
