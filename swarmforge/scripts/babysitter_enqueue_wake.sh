#!/usr/bin/env bash
# Enqueue a wake for the Babysitter runtime (used by handoffd + manual tests).
# No-op unless .swarmforge/babysitter/enabled exists.
#
# Usage: babysitter_enqueue_wake.sh <project-root> <json-event-or-->
#   babysitter_enqueue_wake.sh "$ROOT" '{"type":"handoff","from":"coder","to":"QA"}'
set -euo pipefail
ROOT="${1:?usage: babysitter_enqueue_wake.sh <project-root> <json>}"
EVENT="${2:?usage: babysitter_enqueue_wake.sh <project-root> <json>}"
DIR="$ROOT/.swarmforge/babysitter"
ENABLED="$DIR/enabled"
QUEUE="$DIR/wake-queue.jsonl"

[[ -f "$ENABLED" ]] || exit 0
mkdir -p "$DIR"
printf '%s\n' "$EVENT" >> "$QUEUE"
