#!/usr/bin/env bash
# shift_close_freeze_intake.sh — T−15 before scheduled shift end.
#
# Arms control-pause so seats stop accepting new jobs (no dequeue from
# inbox/new, no backlog promotion). In-flight parcels keep working; a
# completed handoff is accepted into the sender's outbox and waits for
# delivery after the pause clears (same pause semantics as BL-617 /pause).
#
# Soft shift-close (wait_for_expedite_then_bedtime.sh) then waits for every
# role's in_process to empty before finish-shift.
#
# Usage: shift_close_freeze_intake.sh [project-root]
set -u
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
ROOT="${1:-/home/carillon/swarmforgevc}"
ROOT="$(cd "$ROOT" && pwd)"
LOG="$ROOT/.swarmforge/operator/day-shift.log"
PAUSE_MARKER="$ROOT/.swarmforge/operator/control-pause.json"
COOLDOWN_MARKER="$ROOT/.swarmforge/operator/cooldown-window.json"

ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { echo "$(ts) shift-close-freeze $*" >>"$LOG"; }

cd "$ROOT" || { log "FATAL cannot cd $ROOT"; exit 1; }
mkdir -p "$(dirname "$PAUSE_MARKER")"

# untilMs = next local 09:00 (day-shift-start clears pause anyway).
until_ms="$(python3 - <<'PY'
import time
from datetime import datetime, timedelta
now = datetime.now().astimezone()
target = now.replace(hour=9, minute=0, second=0, microsecond=0)
if target <= now:
    target = target + timedelta(days=1)
print(int(target.timestamp() * 1000))
PY
)"

# Consume today's cooldown window-open so apply-cooldown-pause does not
# re-freeze after a mid-drain resume (same stamp the evening-remainder path uses).
window_start_ms="$(python3 - <<'PY'
from datetime import datetime
now = datetime.now().astimezone()
start = now.replace(hour=17, minute=0, second=0, microsecond=0)
# If we are before today's 17:00, that is still the upcoming window instance.
print(int(start.timestamp() * 1000))
PY
)"

python3 - "$PAUSE_MARKER" "$until_ms" "$COOLDOWN_MARKER" "$window_start_ms" <<'PY' >>"$LOG" 2>&1
import json, sys, time
from pathlib import Path
pause_path, until_ms, cool_path, window_start_ms = Path(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3]), int(sys.argv[4])
state = {}
if pause_path.exists():
    try:
        state = json.loads(pause_path.read_text())
    except Exception:
        state = {}
if state.get("active") and state.get("armedBy") == "shift_close_freeze_intake.sh":
    print("shift-close-freeze already armed; leaving in place")
else:
    state = {
        "active": True,
        "untilMs": until_ms,
        "armedAtMs": int(time.time() * 1000),
        "armedBy": "shift_close_freeze_intake.sh",
        "reason": "soft shift-close: stop accepting new jobs 15 minutes before shift end; in-flight tickets finish then bedtime drains",
    }
    pause_path.write_text(json.dumps(state, indent=2) + "\n")
    print("control-pause armed untilMs=%s" % until_ms)
cool_path.write_text(json.dumps({"lastHandledWindowStartMs": window_start_ms}) + "\n")
print("cooldown window %s pre-consumed" % window_start_ms)
PY

log "=== freeze armed (untilMs=$until_ms) ==="
exit 0
