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
line_shift_begin="# swarmforge-shift-schedule-begin $ROOT_A"
line_shift_end="# swarmforge-shift-schedule-end $ROOT_A"
line_marker_only="*/2 * * * * /bin/true $fresh_a"

check "freshness line belongs to root A" "swarmforge_cron_line_belongs_to_root '$line_fresh' '$ROOT_A'"
check "marker-only freshness line belongs to root A" "swarmforge_cron_line_belongs_to_root '$line_marker_only' '$ROOT_A'"
check "schedule line belongs to root A" "swarmforge_cron_line_belongs_to_root '$line_sched' '$ROOT_A'"
# BL-1382 re-tensed this assertion (the human ruled marker-only ownership on
# 2026-09-04, SUP-17 14:13:07Z). It read "orphan operator path belongs to root
# A", which is the policy that erased three hand-installed shift lines from the
# live crontab overnight: a line naming a script under the root, carrying none
# of the swarm's markers, was the swarm's to remove. It is not. What the
# ownership rule owes such a line now is to leave it and SAY so.
check "orphan operator path does NOT belong to root A" "! swarmforge_cron_line_belongs_to_root '$line_orphan' '$ROOT_A'"
check "orphan operator path is reported as left in place" "printf '%s\n' '$line_orphan' | swarmforge_cron_report_unmarked '$ROOT_A' | grep -q 'left in place'"
check "shift schedule begin belongs to root A" "swarmforge_cron_line_belongs_to_root '$line_shift_begin' '$ROOT_A'"
check "shift schedule end belongs to root A" "swarmforge_cron_line_belongs_to_root '$line_shift_end' '$ROOT_A'"
check "sibling line does not belong to root A" "! swarmforge_cron_line_belongs_to_root '$line_sibling' '$ROOT_A'"
check "human line does not belong to root A" "! swarmforge_cron_line_belongs_to_root '$line_human' '$ROOT_A'"

check "root_has_lines detects freshness" "swarmforge_cron_root_has_lines '$ROOT_A' '$line_fresh'"
check "root_has_lines false for human only" "! swarmforge_cron_root_has_lines '$ROOT_A' '$line_human'"

filtered="$(printf '%s\n' "$line_fresh" "$line_marker_only" "$line_sched" "$line_sibling" "$line_human" | swarmforge_cron_filter_out_root "$ROOT_A")"
check "filter keeps sibling freshness" "printf '%s\n' \"\$filtered\" | grep -qF 'FRESHNESS_ROOT=$ROOT_B'"
check "filter keeps human line" "printf '%s\n' \"\$filtered\" | grep -q 'human backup'"
check "filter drops root A lines" "! printf '%s\n' \"\$filtered\" | grep -qF '$ROOT_A'"

if [[ "$fail" -eq 0 ]]; then
  echo "BL-1162 swarmforge-cron property: ALL CHECKS PASSED"
else
  echo "BL-1162 swarmforge-cron property: FAILURES"
  exit 1
fi
