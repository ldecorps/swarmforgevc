#!/usr/bin/env bash
# start_babysitterd.sh — idempotent start of babysitterd (BL-611).
#
# Refuses a second start while a live pidfile exists, leaving the original
# process running. If the pidfile is missing (or stale) but a looping
# babysitterd.sh for THIS root is still alive, ADOPTS that pid — rewrite the
# pidfile, do not spawn a duplicate. The extra-start + EXIT-trap path is
# how a healthy daemon used to look DOWN in ./swarm status.
# Called from start_ancillary_services.sh at swarm launch and from
# swarm_ensure.bb's babysitter-start-cmd for repair.
#
# Usage: start_babysitterd.sh <project-root>
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
start_babysitterd.sh — idempotent start of babysitterd (BL-611).

Stop: stop_ancillary_services.sh / ./stop-swarm.sh

Usage: start_babysitterd.sh <project-root>
EOF
  exit 0
fi

ROOT="$(cd "${1:?usage: start_babysitterd.sh <project-root>}" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/freshness_stop_marker_lib.sh"
DIR="$ROOT/.swarmforge/babysitterd"
PIDFILE="$DIR/babysitterd.pid"
mkdir -p "$DIR"
# BL-785: starting re-arms watching — a deliberate stop must not outlive the
# next start.
freshness_clear_stopped "$ROOT" "babysitterd"

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  echo "babysitterd already running (pid $(cat "$PIDFILE"))"
  exit 0
fi

# POSIX twin of babysitterd_freshness_lib.bb's daemon-cmdline?: match the
# daemon script as its own argv token, never start_babysitterd.sh (same
# suffix) and never --tick-once. Keep the two in lockstep.
find_live_babysitterd_pid() {
  local _root="$1" _pid _args
  while read -r _pid _args; do
    [[ "$_pid" =~ ^[0-9]+$ ]] || continue
    case "$_args" in
      *start_babysitterd.sh*|*--tick-once*) continue ;;
    esac
    case "$_args" in
      *"/babysitterd.sh "*|*" babysitterd.sh "*)
        case "$_args" in
          *"$_root"*)
            printf '%s\n' "$_pid"
            return 0
            ;;
        esac
        ;;
    esac
  done < <(ps -eo pid=,args= 2>/dev/null)
  return 1
}

ORPHAN_PID="$(find_live_babysitterd_pid "$ROOT" || true)"
if [[ -n "${ORPHAN_PID}" ]] && kill -0 "$ORPHAN_PID" 2>/dev/null; then
  echo "$ORPHAN_PID" > "$PIDFILE"
  echo "babysitterd already running (pid $ORPHAN_PID); rewrote pidfile"
  exit 0
fi

# BL-802: macOS ships no setsid. Prefer it when present (existing Linux
# behavior, unchanged); fall back to nohup+disown alone, which is the same
# detachment start_handoff_daemon.sh already relies on with no setsid at all.
if command -v setsid >/dev/null 2>&1; then
  setsid nohup bash "$SCRIPT_DIR/babysitterd.sh" "$ROOT" >/dev/null 2>&1 &
else
  nohup bash "$SCRIPT_DIR/babysitterd.sh" "$ROOT" >/dev/null 2>&1 &
fi
disown

for _ in 1 2 3 4 5; do
  sleep 0.2
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
    echo "babysitterd started (pid $(cat "$PIDFILE"))"
    exit 0
  fi
done

echo "WARN: babysitterd did not confirm a live pidfile after start" >&2
exit 1
