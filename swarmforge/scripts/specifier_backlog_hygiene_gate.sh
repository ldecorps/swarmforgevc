#!/usr/bin/env bash
# specifier_backlog_hygiene_gate.sh — fail loud on epic/milestone gaps in ticket YAML
# the specifier is about to hand off. Run on each paused item written this turn.
#
# Usage: specifier_backlog_hygiene_gate.sh <yaml-path> [<yaml-path> ...]
# Exit 0 when every file is clean; exit 1 on first violation batch.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $# -lt 1 ]]; then
  echo "Usage: specifier_backlog_hygiene_gate.sh <yaml-path> [<yaml-path> ...]" >&2
  exit 2
fi

bb "$SCRIPT_DIR/specifier_backlog_hygiene_gate.bb" "$@"
