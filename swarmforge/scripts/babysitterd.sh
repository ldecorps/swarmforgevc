#!/usr/bin/env bash
# babysitterd.sh — loop daemon: calls babysitter_check.sh --nudge every
# BABYSITTERD_INTERVAL_S (default 300s), forever (BL-611).
#
# Managed by the swarm lifecycle like the other daemons — see
# start_babysitterd.sh (start), stop_ancillary_services.sh / kill_all_swarm.sh
# (stop, via pidfile signal), swarm_ensure.bb (restart-if-dead).
#
# Usage:
#   babysitterd.sh <project-root>              # loop forever (use start_babysitterd.sh to detach)
#   babysitterd.sh <project-root> --tick-once   # one sweep + heartbeat, then exit (tests)
#
# State (distinct from the retired LLM hawk's .swarmforge/babysitter/):
#   .swarmforge/babysitterd/babysitterd.pid
#   .swarmforge/babysitterd/babysitterd.log   (bounded ~2000 lines; a
#                                               "heartbeat" line every tick —
#                                               daemon_log_freshness.conf's
#                                               freshness signal)
set -u
ROOT="$(cd "${1:?usage: babysitterd.sh <project-root> [--tick-once]}" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="$ROOT/.swarmforge/babysitterd"
PIDFILE="$DIR/babysitterd.pid"
LOG="$DIR/babysitterd.log"
INTERVAL_S="${BABYSITTERD_INTERVAL_S:-300}"
TICK_ONCE=0
[[ "${2:-}" == "--tick-once" ]] && TICK_ONCE=1

mkdir -p "$DIR"

tick() {
  bash "$SCRIPT_DIR/babysitter_check.sh" "$ROOT" --nudge >> "$LOG" 2>&1
  # Content-free pulse, independent of the sweep's own OK/finding lines, so
  # the cron-side freshness checker (daemon_log_freshness_check.sh) never
  # confuses a quiet-but-alive sweep with a wedged loop.
  printf '%s heartbeat\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG"
  local lines
  lines="$(wc -l < "$LOG" 2>/dev/null || echo 0)"
  if [[ "$lines" -gt 4000 ]]; then
    tail -2000 "$LOG" > "$LOG.t" && mv "$LOG.t" "$LOG"
  fi
}

if [[ "$TICK_ONCE" -eq 1 ]]; then
  tick
  exit 0
fi

# Single-instance guard.
if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  echo "babysitterd already running (pid $(cat "$PIDFILE"))" >&2
  exit 1
fi
echo $$ > "$PIDFILE"
# Only unlink OUR pid. A second start that raced the missing-pidfile window
# can overwrite the file; a blindly-rm EXIT trap is how the original live
# process lost its pidfile and ./swarm status reported DOWN.
# babysitterd_freshness_lib.bb's should-unlink-pidfile? is a pure twin of
# this decision (BL-906 invariant 2, property-tested); MUST stay aligned.
trap 'recorded=$(tr -d "[:space:]" < "$PIDFILE" 2>/dev/null || true)
      if [ "$recorded" = "$$" ]; then rm -f "$PIDFILE"; fi' EXIT

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) babysitterd start pid=$$ interval=${INTERVAL_S}s" >> "$LOG"
while true; do
  tick
  sleep "$INTERVAL_S"
done
