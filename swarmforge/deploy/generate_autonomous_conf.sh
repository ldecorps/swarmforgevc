#!/usr/bin/env bash
# BL-628: generates a per-host AUTONOMOUS-mode conf for a bare Linux box
# from the shared packs/autonomous-swarm.conf template, substituting only
# the swarm_name line - every box needs a name unique among the operator's
# live swarms, and this shape carries no `config swarm_mode` line at all
# (swarmforge.sh's own default is already "autonomous" - see the template's
# own header comment).
#
# Usage: generate_autonomous_conf.sh <swarm-name> [output-path]
#   swarm-name:  this box's unique swarm_name (e.g. "acme-vps", "widget-pi")
#   output-path: where to write the conf; defaults to stdout
#
# Env:
#   SWARMFORGE_SYSTEMD_UNIT_DIR  where to check for an already-live swarm's
#                                unit (default /etc/systemd/system) - the
#                                seam a test overrides to simulate a
#                                collision without touching the real host.
#
# Validated the same way packs/second-swarm.conf itself is
# (test_second_swarm_pack.sh): by sourcing the real swarmforge.sh parser
# against the generated output, never a hand-rolled re-implementation of
# its rules.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$SCRIPT_DIR/../packs/autonomous-swarm.conf"

SWARM_NAME="${1:?Usage: generate_autonomous_conf.sh <swarm-name> [output-path]}"
OUTPUT_PATH="${2:-}"
UNIT_DIR="${SWARMFORGE_SYSTEMD_UNIT_DIR:-/etc/systemd/system}"

if [[ ! "$SWARM_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "generate_autonomous_conf.sh: swarm-name must be alphanumeric/dash/underscore only, got: $SWARM_NAME" >&2
  exit 1
fi

if [[ "$SWARM_NAME" == "autonomous" ]]; then
  echo "generate_autonomous_conf.sh: refusing to generate a conf still named 'autonomous' - that is the placeholder name shipped in packs/autonomous-swarm.conf itself; pick a name unique to THIS box" >&2
  exit 1
fi

if [[ -f "$UNIT_DIR/swarmforge-${SWARM_NAME}.service" ]]; then
  echo "generate_autonomous_conf.sh: refusing to generate a conf named '$SWARM_NAME' - a swarm unit of that name is already live on this host ($UNIT_DIR/swarmforge-${SWARM_NAME}.service exists); pick a name unique to this box" >&2
  exit 1
fi

if [[ -n "$OUTPUT_PATH" ]] && [[ -e "$OUTPUT_PATH" ]] && [[ "$(cd "$(dirname "$OUTPUT_PATH")" && pwd)/$(basename "$OUTPUT_PATH")" == "$(cd "$(dirname "$TEMPLATE")" && pwd)/$(basename "$TEMPLATE")" ]]; then
  echo "generate_autonomous_conf.sh: refusing to overwrite the shared template itself ($TEMPLATE) - pick a swarm-name that does not collide with 'autonomous-swarm.conf'" >&2
  exit 1
fi

GENERATED="$(sed "s/^config swarm_name autonomous\$/config swarm_name $SWARM_NAME/" "$TEMPLATE")"

if [[ -n "$OUTPUT_PATH" ]]; then
  printf '%s\n' "$GENERATED" > "$OUTPUT_PATH"
else
  printf '%s\n' "$GENERATED"
fi
