#!/usr/bin/env bash
# BL-2048: the property-runner front-end. Lists every *_property_runner.{bb,sh,js}
# file directly in a directory in name order, picks each one's interpreter from
# its extension, and runs them on BL-2027's recorded lane runner, so one
# command runs the population, leaves one duration row per runner and names
# every red. Observation only: it never reorders, skips, or alters what it
# runs.
#
#   run_property_runners.sh [--limit N] [--durations <path>] [--changed-from <ref>] [dir]
#
# `dir` defaults to this script's own directory. `--durations` defaults to
# swarmforge/scripts/test/.property-runner-durations.jsonl. Exits with the
# runner's status.
#
# BL-2049: --changed-from <ref> narrows the population to exactly the
# runners property_runner_reach.bb (swarmforge/scripts/, one level above
# this script's own directory) says `git diff --name-only <ref>...HEAD`
# reaches, in the repository holding `dir` - never a re-listing of all
# 217 (the 2026-10-06 census: the first 88 alone took 20 minutes on the
# swarm host). When none is reached it prints "no property runner
# reached since <ref>" and exits 0, running nothing.

set -uo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)

limit=''
durations="$script_dir/.property-runner-durations.jsonl"
dir=''
changed_from=''

while [ $# -gt 0 ]; do
  case "$1" in
    --limit)        limit="$2"; shift 2 ;;
    --durations)    durations="$2"; shift 2 ;;
    --changed-from) changed_from="$2"; shift 2 ;;
    *) dir="$1"; shift ;;
  esac
done

if [ -z "$dir" ]; then
  dir="$script_dir"
fi

reached_filter=''
if [ -n "$changed_from" ]; then
  repo_root=$(cd "$dir" && git rev-parse --show-toplevel)
  scripts_dir=$(cd "$dir/.." && pwd)
  changed_args=()
  while IFS= read -r line; do
    [ -n "$line" ] && changed_args+=("$line")
  done < <(cd "$repo_root" && git diff --name-only "${changed_from}...HEAD")
  reached=$(bb "$script_dir/../property_runner_reach.bb" "$scripts_dir" "${changed_args[@]}")
  if [ -z "$reached" ]; then
    echo "no property runner reached since $changed_from"
    exit 0
  fi
  reached_filter="$reached"
fi

list=$(mktemp)
trap 'rm -f "$list"' EXIT

# Every file directly in dir whose name ends _property_runner.bb/.sh/.js,
# in name order - narrowed to $reached_filter's own names when
# --changed-from named one.
find -H "$dir" -maxdepth 1 -type f \( -name '*_property_runner.bb' -o -name '*_property_runner.sh' -o -name '*_property_runner.js' \) \
  | LC_ALL=C sort \
  | while IFS= read -r f; do
    if [ -n "$changed_from" ] && ! grep -qxF "$(basename "$f")" <<<"$reached_filter"; then
      continue
    fi
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
