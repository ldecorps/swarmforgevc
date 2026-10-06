#!/usr/bin/env bash
# BL-2048: the property-runner front-end. Lists every *_property_runner.{bb,sh,js}
# file directly in a directory in name order, picks each one's interpreter from
# its extension, and runs them on BL-2027's recorded lane runner, so one
# command runs the population, leaves one duration row per runner and names
# every red. Observation only: it never reorders, skips, or alters what it
# runs.
#
#   run_property_runners.sh [--limit N] [--durations <path>] [dir]
#
# `dir` defaults to this script's own directory. `--durations` defaults to
# swarmforge/scripts/test/.property-runner-durations.jsonl. Exits with the
# runner's status.

set -uo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)

limit=''
durations="$script_dir/.property-runner-durations.jsonl"
dir=''

while [ $# -gt 0 ]; do
  case "$1" in
    --limit)     limit="$2"; shift 2 ;;
    --durations) durations="$2"; shift 2 ;;
    *) dir="$1"; shift ;;
  esac
done

if [ -z "$dir" ]; then
  dir="$script_dir"
fi

list=$(mktemp)
trap 'rm -f "$list"' EXIT

# Every file directly in dir whose name ends _property_runner.bb/.sh/.js,
# in name order.
find -H "$dir" -maxdepth 1 -type f \( -name '*_property_runner.bb' -o -name '*_property_runner.sh' -o -name '*_property_runner.js' \) \
  | LC_ALL=C sort \
  | while IFS= read -r f; do
    case "$f" in
      *.bb) printf '%s\tbb %s\n' "$f" "$f" ;;
      *.sh) printf '%s\tbash %s\n' "$f" "$f" ;;
      *.js) printf '%s\tnode %s\n' "$f" "$f" ;;
    esac
  done > "$list"

runner="$script_dir/run_recorded_lane.sh"
args=(bash "$runner" --lane property-runners --list "$list" --durations "$durations")
if [ -n "$limit" ]; then
  args+=(--limit "$limit")
fi
exec "${args[@]}"
