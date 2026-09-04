#!/usr/bin/env bash
# wait_for_expedite_then_bedtime.sh — scheduled bedtime that waits out an
# in-flight expedite run instead of killing it, and holds the swarm down
# if the run finishes after hours.
#
# Human request (2026-09-03): "the swarm should let the expedition
# complete. and if that finishes after hours, then don't restart the
# pack." Two separate hazards this closes, both real, neither hypothetical:
#
#   1. finish-shift -> kill_pipeline_swarm.sh's graceful_stop_agents SIGTERMs
#      every `claude .*$ROOT/.swarmforge/launch/` process. An expedite run's
#      per-stage claude invocations reuse the SAME per-role
#      .swarmforge/launch/<role>.claude-settings.json files the standing
#      swarm's tmux panes use, so that pgrep pattern cannot tell an
#      in-flight expedite stage from a standing-pack pane - a plain bedtime
#      call would kill it mid-stage.
#
#   2. expedite_cli.bb's own last phase (restart-stack!) calls
#      ./start-swarm.sh by default when a run finishes (BL-567's "the
#      restart cannot fail the run" design). If that finish lands after the
#      scheduled bedtime, it would bring the swarm right back up outside
#      shift hours with nothing here to stop it.
#
# Fix: while an expedite_cli.bb process for this root is alive, arm the
# SAME control-pause.json marker restart-stack! already checks before it
# runs anything (BL-1249's restart-hold-verdict: active:true -> :held,
# reported loudly, start command never runs) - armed BEFORE the wait, not
# after, so it is in place no matter which side of bedtime the run actually
# finishes on. Then poll (never signal/kill) until the process exits, only
# THEN run finish-shift. day-shift-start.sh / night-start.sh already clear
# control-pause.json unconditionally at the very next scheduled start, so
# the hold self-expires - nothing here needs to un-arm it.
#
# No expedite in flight at call time: this is a plain, immediate
# finish-shift, same as before.
#
# Usage: wait_for_expedite_then_bedtime.sh [project-root]
set -u
ROOT="${1:-/home/carillon/swarmforgevc}"
LOG="$ROOT/.swarmforge/operator/day-shift.log"
PAUSE_MARKER="$ROOT/.swarmforge/operator/control-pause.json"
POLL_SECONDS=60
# Safety ceiling, not a real expectation: a 90min/stage x ~7-stage run with
# bounces can legitimately run long, so this is generous - but a silently
# wedged bb process should not hold bedtime forever either. Loud, not
# silent, if ever hit.
MAX_WAIT_SECONDS=21600

ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { echo "$(ts) wait-for-expedite-then-bedtime $*" >>"$LOG"; }

cd "$ROOT" || { log "FATAL cannot cd $ROOT"; exit 1; }

expedite_pid() {
  pgrep -f "expedite_cli\.bb $ROOT" 2>/dev/null | head -1
}

pid="$(expedite_pid)"
if [ -n "$pid" ]; then
  log "expedite in flight (pid=$pid) - arming control-pause hold so its own restart phase cannot bring the swarm back up after hours"
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
print("control-pause armed")
PY

  waited=0
  while [ -n "$pid" ]; do
    if [ "$waited" -ge "$MAX_WAIT_SECONDS" ]; then
      log "WARN waited ${waited}s (>= ${MAX_WAIT_SECONDS}s ceiling) for expedite pid=$pid to finish - proceeding to bedtime anyway, hold marker stays armed"
      break
    fi
    sleep "$POLL_SECONDS"
    waited=$((waited + POLL_SECONDS))
    pid="$(expedite_pid)"
  done
  if [ -z "$pid" ]; then
    log "expedite finished after ${waited}s wait - proceeding to bedtime (control-pause hold already stopped its own restart, if it got that far)"
  fi
else
  log "no expedite in flight - proceeding straight to bedtime"
fi

"$ROOT/finish-shift" >>"$LOG" 2>&1
rc=$?
log "finish-shift rc=$rc"
exit "$rc"
