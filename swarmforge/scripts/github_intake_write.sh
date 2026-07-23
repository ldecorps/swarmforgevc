#!/usr/bin/env bash
# BL-560 (extracted from .github/workflows/swarm-intake.yml's "Write backlog
# root item" step, BL-227/BL-114): writes backlog/GH-<n>-<slug>.yaml for one
# GitHub issue, relative to the current working directory (the caller cds
# into the checked-out repo root first). The ONE shape both the
# label-triggered swarm-intake.yml workflow and the scheduled
# github_intake_scan.sh scan call, so a human-applied label and a scheduled
# scan can never diverge into two different YAML shapes for the same kind of
# issue (BL-560 pin: "do not invent a second YAML shape").
#
# Usage: github_intake_write.sh <issue-number> <title> <body> <url>
# Prints the written file's path to stdout.
set -euo pipefail

NUM="${1:?Usage: github_intake_write.sh <issue-number> <title> <body> <url>}"
TITLE="${2:?Usage: github_intake_write.sh <issue-number> <title> <body> <url>}"
BODY="${3-}"
URL="${4:?Usage: github_intake_write.sh <issue-number> <title> <body> <url>}"

slug=$(printf '%s' "$TITLE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\+/-/g; s/^-\|-$//g' | cut -c1-50)
file="backlog/GH-${NUM}-${slug}.yaml"

{
  echo "id: GH-${NUM}"
  echo "title: $(printf '%s' "$TITLE" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
  echo "source: ${URL}"
  echo "description: |"
  printf '%s\n' "$BODY" | sed 's/^/  /'
} > "$file"

echo "$file"
