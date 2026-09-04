#!/usr/bin/env bash
# BL-1162: install root-scoped shift schedule lines into the live user crontab.
# Uses swarm_shift conf when present; otherwise legacy continuous-shifts.json.
#
# Usage: install_shift_schedule_cron.sh <project-root>
set -euo pipefail

ROOT="${1:?usage: install_shift_schedule_cron.sh <project-root>}"
ROOT="$(cd "$ROOT" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# BL-1381: the reconcile script's PATH is injectable so the wrapper's failure
# paths can be driven with a stub. This is a seam, not a bypass - it overrides
# WHICH program runs, never what verdict the wrapper reaches, so no test can
# force an outcome the real code would not produce.
RECONCILE_BB="${SHIFT_SCHEDULE_RECONCILE_BB:-$SCRIPT_DIR/reconcile_shift_schedule_crontab.bb}"

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
# BL-1381: capture the reconcile's own failure rather than letting `set -e`
# abort here. An abort exits non-zero with NO message, which is invariant 2's
# other half unmet - every non-zero path must name its cause.
if ! result="$(bb "$RECONCILE_BB" "$ROOT" 2>&1)"; then
  echo "install_shift_schedule_cron.sh: the reconcile failed for $ROOT - refusing to report a verdict it never gave" >&2
  [[ -n "$result" ]] && echo "install_shift_schedule_cron.sh: reconcile said: $result" >&2
  exit 1
fi
result_file="$(mktemp)"
trap 'rm -f "$result_file"' EXIT
printf '%s' "$result" > "$result_file"

# BL-1381 invariant 2: this wrapper exits zero on exactly three named
# outcomes, and every other path exits non-zero naming its cause.
#
# The parse used to sit in a `read -r ... < <(python3 ...)` process
# substitution, whose failure `set -e` cannot observe. A reconcile that exited
# ZERO but printed nothing - or printed something that is not JSON - therefore
# left every variable empty, and the wrapper announced "No shift schedule
# configured" and exited 0. A silent good outcome manufactured from a real
# failure, on the path that runs at every ./swarm start.
if [[ ! -s "$result_file" ]]; then
  echo "install_shift_schedule_cron.sh: the reconcile produced no output for $ROOT - refusing to report a verdict it never gave" >&2
  exit 1
fi

# 2>/dev/null: the operator gets the named cause below, never a raw
# interpreter traceback. A stack trace in launch output is what made this
# failure unreadable in the first place.
if ! parsed="$(python3 - "$result_file" 2>/dev/null <<'PYPARSE'
import json, sys
d = json.load(open(sys.argv[1]))
if not isinstance(d, dict):
    raise SystemExit("reconcile output is not a JSON object")
print(d.get("scheduling?", False), d.get("changed?", False), d.get("mode", "none"))
PYPARSE
)"; then
  echo "install_shift_schedule_cron.sh: could not parse the reconcile output for $ROOT - refusing to report a verdict it never gave" >&2
  exit 1
fi

read -r scheduling changed mode <<<"$parsed"

if [[ -z "${scheduling:-}" ]]; then
  echo "install_shift_schedule_cron.sh: the reconcile output carried no scheduling verdict for $ROOT" >&2
  exit 1
fi

if [[ "$scheduling" != "True" && "$scheduling" != "true" ]]; then
  echo "No shift schedule configured for $ROOT — skipping schedule cron install"
  exit 0
fi

if [[ "$changed" != "True" && "$changed" != "true" ]]; then
  echo "Shift schedule cron already current for $ROOT (mode=$mode)"
  exit 0
fi

new_lines="$(python3 - "$result_file" <<'PY'
import json, sys
print("\n".join(json.load(open(sys.argv[1])).get("lines", [])))
PY
)"
if [[ -z "${new_lines//[[:space:]]/}" ]]; then
  crontab -r 2>/dev/null || true
else
  printf '%s\n' "$new_lines" | grep -v '^$' | crontab -
fi

echo "Installed shift schedule cron for $ROOT (mode=$mode)"
printf '%s\n' "$new_lines" | grep -E 'swarmforge-shift-schedule|swarmforge-operator-schedule|start-swarm|operator/' || true
