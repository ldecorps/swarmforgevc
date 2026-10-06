#!/usr/bin/env bash
# BL-2027: the recorded lane runner. Runs a listed population one item at a
# time, in the list's order, appending one duration row per completed item,
# and prints a verdict that names every failing item. Observation only: it
# never reorders, skips, or alters what it runs.
#
#   run_recorded_lane.sh --lane <name> --list <file> --durations <path> [--limit N]
#
# Each line of --list is `<item>` TAB `<command ...>`. With --limit N, only
# the first N lines run. Exits 1 when any item failed, else 0.

set -uo pipefail

# Whole-millisecond clock: GNU date's %3N is not portable (BSD date on
# macOS prints a literal 3N), so fall back to node when date's output is
# not all digits (amended 2026-10-06, QA note 003849).
now_ms() {
  local v
  v=$(date +%s%3N)
  if [[ "$v" =~ ^[0-9]+$ ]]; then
    printf '%s' "$v"
  else
    node -e 'process.stdout.write(String(Date.now()))'
  fi
}

lane=''
list=''
durations=''
limit=''

while [ $# -gt 0 ]; do
  case "$1" in
    --lane)      lane="$2"; shift 2 ;;
    --list)      list="$2"; shift 2 ;;
    --durations) durations="$2"; shift 2 ;;
    --limit)     limit="$2"; shift 2 ;;
    *) echo "run_recorded_lane.sh: unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$lane" ] || [ -z "$list" ] || [ -z "$durations" ]; then
  echo "run_recorded_lane.sh: --lane, --list and --durations are required" >&2
  exit 2
fi

passed=0
failed=0
failed_items=()
slowest=()
start_wall=$(now_ms)

lineno=0
while IFS=$'\t' read -r item cmd || [ -n "$item" ]; do
  lineno=$((lineno + 1))
  if [ -n "$limit" ] && [ "$lineno" -gt "$limit" ]; then
    break
  fi
  [ -z "$item" ] && continue

  t0=$(now_ms)
  st=0
  bash -c "$cmd" </dev/null || st=$?
  t1=$(now_ms)
  dur=$((t1 - t0))
  finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  if [ "$st" -eq 0 ]; then
    result=pass
    passed=$((passed + 1))
  else
    result=fail
    failed=$((failed + 1))
    failed_items+=("$item")
  fi

  printf '{"finished_at":"%s","lane":"%s","file":"%s","result":"%s","duration_ms":%d}\n' \
    "$finished_at" "$lane" "$item" "$result" "$dur" >> "$durations"
  slowest+=("$dur $item")
done < "$list"

end_wall=$(now_ms)
wall_ms=$((end_wall - start_wall))

echo "passed $passed failed $failed"
for item in ${failed_items[@]+"${failed_items[@]}"}; do
  echo "FAILED $item"
done

# Up to ten slowest items, by duration descending.
if [ "${#slowest[@]}" -gt 0 ]; then
  printf '%s\n' "${slowest[@]}" | sort -rn | head -10 | while read -r dur item; do
    printf 'slowest %s %ss\n' "$item" "$((dur / 1000))"
  done
fi

printf 'wall %ss\n' "$((wall_ms / 1000))"

if [ "$failed" -gt 0 ]; then
  exit 1
fi
exit 0
