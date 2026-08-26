#!/usr/bin/env bash
# BL-1162: property tests for declared invariants on root-scoped cron lines.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC1091
source "$SRC/swarmforge_cron_lib.sh"

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

ROOT_A="/tmp/swarmforge-bl1162-prop-a"
ROOT_B="/tmp/swarmforge-bl1162-prop-b"

fresh_a="$(swarmforge_cron_freshness_marker "$ROOT_A")"
sched_a="$(swarmforge_cron_operator_schedule_marker "$ROOT_A")"
line_fresh="*/2 * * * * PATH=/bin FRESHNESS_ROOT=$ROOT_A /bin/sh /x/check.sh $fresh_a"
line_sched="0 9 * * * $ROOT_A/.swarmforge/operator/day-shift-start.sh $sched_a kind=start"
line_sibling="*/2 * * * * PATH=/bin FRESHNESS_ROOT=$ROOT_B /bin/sh /x/check.sh $(swarmforge_cron_freshness_marker "$ROOT_B")"
line_human="# human backup job"
line_orphan="0 9 * * * $ROOT_A/.swarmforge/operator/night-start.sh"

check "freshness line belongs to root A" "swarmforge_cron_line_belongs_to_root '$line_fresh' '$ROOT_A'"
check "schedule line belongs to root A" "swarmforge_cron_line_belongs_to_root '$line_sched' '$ROOT_A'"
check "orphan operator path belongs to root A" "swarmforge_cron_line_belongs_to_root '$line_orphan' '$ROOT_A'"
check "sibling line does not belong to root A" "! swarmforge_cron_line_belongs_to_root '$line_sibling' '$ROOT_A'"
check "human line does not belong to root A" "! swarmforge_cron_line_belongs_to_root '$line_human' '$ROOT_A'"

filtered="$(printf '%s\n' "$line_fresh" "$line_sched" "$line_sibling" "$line_human" | swarmforge_cron_filter_out_root "$ROOT_A")"
check "filter keeps sibling freshness" "printf '%s\n' \"\$filtered\" | grep -qF 'FRESHNESS_ROOT=$ROOT_B'"
check "filter keeps human line" "printf '%s\n' \"\$filtered\" | grep -q 'human backup'"
check "filter drops root A lines" "! printf '%s\n' \"\$filtered\" | grep -qF '$ROOT_A'"

if [[ "$fail" -eq 0 ]]; then
  echo "BL-1162 swarmforge-cron property: ALL CHECKS PASSED"
else
  echo "BL-1162 swarmforge-cron property: FAILURES"
  exit 1
fi
