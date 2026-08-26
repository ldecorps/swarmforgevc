#!/usr/bin/env bash
# BL-1162: install root-scoped shift schedule lines into the live user crontab.
# Uses swarm_shift conf when present; otherwise legacy continuous-shifts.json.
#
# Usage: install_shift_schedule_cron.sh <project-root>
set -euo pipefail

ROOT="${1:?usage: install_shift_schedule_cron.sh <project-root>}"
ROOT="$(cd "$ROOT" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECONCILE_BB="$SCRIPT_DIR/reconcile_shift_schedule_crontab.bb"

if ! command -v crontab >/dev/null 2>&1; then
  echo "install_shift_schedule_cron.sh: no crontab command on this host; schedule lines will NOT run for $ROOT" >&2
  exit 1
fi

if ! command -v bb >/dev/null 2>&1; then
  echo "install_shift_schedule_cron.sh: bb missing; cannot render schedule for $ROOT" >&2
  exit 1
fi

existing="$(crontab -l 2>/dev/null || true)"
export CRONTAB_LINES="$existing"
result="$(bb "$RECONCILE_BB" "$ROOT")"
result_file="$(mktemp)"
trap 'rm -f "$result_file"' EXIT
printf '%s' "$result" > "$result_file"

scheduling="$(python3 -c "import json; print(json.load(open('$result_file')).get('scheduling?', False))")"
changed="$(python3 -c "import json; print(json.load(open('$result_file')).get('changed?', False))")"
mode="$(python3 -c "import json; print(json.load(open('$result_file')).get('mode', 'none'))")"

if [[ "$scheduling" != "True" && "$scheduling" != "true" ]]; then
  echo "No shift schedule configured for $ROOT — skipping schedule cron install"
  exit 0
fi

if [[ "$changed" != "True" && "$changed" != "true" ]]; then
  echo "Shift schedule cron already current for $ROOT (mode=$mode)"
  exit 0
fi

new_lines="$(python3 -c "import json; print('\\n'.join(json.load(open('$result_file'))['lines']))")"
if [[ -z "${new_lines//[[:space:]]/}" ]]; then
  crontab -r 2>/dev/null || true
else
  printf '%s\n' "$new_lines" | grep -v '^$' | crontab -
fi

echo "Installed shift schedule cron for $ROOT (mode=$mode)"
printf '%s\n' "$new_lines" | grep -E 'swarmforge-shift-schedule|swarmforge-operator-schedule|start-swarm|operator/' || true
