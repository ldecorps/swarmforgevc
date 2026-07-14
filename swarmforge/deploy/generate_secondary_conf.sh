#!/usr/bin/env bash
# BL-101: generates a per-host secondary-mode conf for a headless box (Pi/VPS)
# from the shared packs/second-swarm.conf template, substituting only the
# swarm_name line - every box needs a name unique across the operator's
# swarms (BL-090 multi-swarm-06 rejects a duplicate), while the rest of the
# pack (secondary mode naming the primary, the full pipeline minus
# coordinator) is identical on every host.
#
# Usage: generate_secondary_conf.sh <swarm-name> [output-path]
#   swarm-name:  this box's unique swarm_name (e.g. "pi5", "vps-hetzner1")
#   output-path: where to write the conf; defaults to stdout
#
# Validated the same way packs/second-swarm.conf itself is (test_second_
# swarm_pack.sh): by sourcing the real swarmforge.sh parser against the
# generated output, never a hand-rolled re-implementation of its rules.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$SCRIPT_DIR/../packs/second-swarm.conf"

SWARM_NAME="${1:?Usage: generate_secondary_conf.sh <swarm-name> [output-path]}"
OUTPUT_PATH="${2:-}"

if [[ ! "$SWARM_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "generate_secondary_conf.sh: swarm-name must be alphanumeric/dash/underscore only, got: $SWARM_NAME" >&2
  exit 1
fi

if [[ "$SWARM_NAME" == "second" ]]; then
  echo "generate_secondary_conf.sh: refusing to generate a conf still named 'second' - the operator's real primary already assigns tickets to a box with that placeholder name; pick a name unique to THIS box" >&2
  exit 1
fi

if [[ -n "$OUTPUT_PATH" ]] && [[ -e "$OUTPUT_PATH" ]] && [[ "$(cd "$(dirname "$OUTPUT_PATH")" && pwd)/$(basename "$OUTPUT_PATH")" == "$(cd "$(dirname "$TEMPLATE")" && pwd)/$(basename "$TEMPLATE")" ]]; then
  echo "generate_secondary_conf.sh: refusing to overwrite the shared template itself ($TEMPLATE) - pick a swarm-name that does not collide with 'second-swarm.conf'" >&2
  exit 1
fi

GENERATED="$(sed "s/^config swarm_name second\$/config swarm_name $SWARM_NAME/" "$TEMPLATE")"

if [[ -n "$OUTPUT_PATH" ]]; then
  printf '%s\n' "$GENERATED" > "$OUTPUT_PATH"
else
  printf '%s\n' "$GENERATED"
fi
