#!/usr/bin/env bash
# wait_for_expedite_then_bedtime.sh — soft scheduled bedtime.
#
# Soft shift-close (human via Cursor 2026-10-08):
#   1. Freeze new-job intake (control-pause) if not already armed at T−15
#      by shift_close_freeze_intake.sh — seats stop accepting new work;
#      in-flight parcels keep going.
#   2. Wait out an in-flight expedite run (never kill it); arm control-pause
#      so its restart-stack phase cannot bring the pack back up after hours.
#   3. Drain until every role's inbox/in_process is empty (push-forward or
#      bounce), bounded by SWARMFORGE_SHIFT_CLOSE_DRAIN_TIMEOUT_MS (default 4h).
#   4. ./finish-shift (BL-762 bedtime): stop token-burning seats, keep phone.
#
# Legacy hard-kill at the shift-end bell is gone: finish-shift only runs after
# the in-flight drain (or its forced ceiling).
#
# Usage: wait_for_expedite_then_bedtime.sh [project-root]
set -u
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
ROOT="${1:-/home/carillon/swarmforgevc}"
ROOT="$(cd "$ROOT" && pwd)"
LOG="$ROOT/.swarmforge/operator/day-shift.log"
PAUSE_MARKER="$ROOT/.swarmforge/operator/control-pause.json"
POLL_SECONDS=60
MAX_WAIT_SECONDS=21600
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { echo "$(ts) wait-for-expedite-then-bedtime $*" >>"$LOG"; }

cd "$ROOT" || { log "FATAL cannot cd $ROOT"; exit 1; }
mkdir -p "$(dirname "$LOG")"

# 1. Freeze new jobs (idempotent if T−15 already armed it).
bash "$SCRIPT_DIR/shift_close_freeze_intake.sh" "$ROOT" >>"$LOG" 2>&1 || log "WARN freeze step rc=$?"

expedite_pid() {
  pgrep -f "expedite_cli\.bb $ROOT" 2>/dev/null | head -1
}

# 2. Wait out expedite (and keep the hold so its restart cannot revive us).
pid="$(expedite_pid)"
if [ -n "$pid" ]; then
  log "expedite in flight (pid=$pid) - ensuring control-pause hold so its own restart phase cannot bring the swarm back up after hours"
  python3 - "$PAUSE_MARKER" <<'PY' >>"$LOG" 2>&1
import json, sys, time
from pathlib import Path
p = Path(sys.argv[1])
state = {}
if p.exists():
    try:
        state = json.loads(p.read_text())
    except Exception:
        state = {}
state.update({
    "active": True,
    "armedAtMs": int(time.time() * 1000),
    "armedBy": "wait_for_expedite_then_bedtime.sh",
    "reason": "in-flight expedite at scheduled bedtime - held until the next scheduled shift start clears this",
})
p.write_text(json.dumps(state, indent=2) + "\n")
print("control-pause armed for expedite hold")
PY

  waited=0
  while [ -n "$pid" ]; do
    if [ "$waited" -ge "$MAX_WAIT_SECONDS" ]; then
      log "WARN waited ${waited}s (>= ${MAX_WAIT_SECONDS}s ceiling) for expedite pid=$pid to finish - proceeding to in-flight drain anyway, hold marker stays armed"
      break
    fi
    sleep "$POLL_SECONDS"
    waited=$((waited + POLL_SECONDS))
    pid="$(expedite_pid)"
  done
  if [ -z "$pid" ]; then
    log "expedite finished after ${waited}s wait - proceeding to in-flight drain"
  fi
else
  log "no expedite in flight - proceeding to in-flight drain"
fi

# 3. Soft drain: every current ticket pushed forward or bounced.
export WAIT_IN_FLIGHT_DRAIN_LOG="$LOG"
outcome="$(bash "$SCRIPT_DIR/wait_in_flight_drain.sh" "$ROOT" 2>>"$LOG" || true)"
log "in-flight drain outcome=$outcome"
if [ "$outcome" != "drained" ] && [ "$outcome" != "forced" ]; then
  log "WARN unexpected drain outcome '$outcome' - treating as forced"
  outcome=forced
fi

# 4. Bedtime.
"$ROOT/finish-shift" >>"$LOG" 2>&1
rc=$?
log "finish-shift rc=$rc drain=$outcome"
exit "$rc"
