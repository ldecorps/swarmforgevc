#!/usr/bin/env bash
# BL-567: the expeditor. Drives ONE ticket through every pipeline gate with the
# swarm stopped, depending on none of the swarm's runtime machinery.
#
# Thin wrapper by design (the CLI main() thin-wrapper rule): every decision lives
# in expedite_lib.bb and every orchestration step in expedite_cli.bb, so both stay
# testable without a swarm. This file resolves paths and delegates.
#
# Usage:
#   expedite.sh <BL-id> [options]              # defaults to this repo's root
#   expedite.sh <project-root> <BL-id> [options]
#
# Options are passed through to expedite_cli.bb:
#   --override            proceed despite a live swarm the stop could not clear
#   --bounce-bound N      per-stage bound (default 3; a raise is always recorded)
#   --stage-timeout-ms N  per-stage budget (default 45 min)
#   --no-restart          skip the final restart phase
#   --dry-run             plan and print; touch nothing
#
# WHY the restart cannot fail the run: use case 1 is fixing a broken swarm
# workflow, so the start path may itself be what was under repair. The ticket is
# done when QA stamps it and the yaml moves; the restart reports separately.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "Usage: expedite.sh [<project-root>] <BL-id> [options]" >&2
  exit 2
fi

# One positional means "this repo, that ticket"; two means an explicit root.
if [[ "$1" =~ ^BL-[0-9]+$ ]]; then
  exec bb "$SCRIPT_DIR/expedite_cli.bb" "$REPO_ROOT" "$@"
else
  exec bb "$SCRIPT_DIR/expedite_cli.bb" "$@"
fi
