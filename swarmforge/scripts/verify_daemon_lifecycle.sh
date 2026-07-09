#!/usr/bin/env bash
# Verify handoffd is up (or start it), logging every probe for post-mortem.
set -euo pipefail

ROOT="${1:-$(pwd)}"
ROOT="$(cd "$ROOT" && pwd -P)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAEMON_DIR="$ROOT/.swarmforge/daemon"
AUDIT="$DAEMON_DIR/daemon-start-audit.log"
MAX_ATTEMPTS="${DAEMON_VERIFY_ATTEMPTS:-60}"

source "$SCRIPT_DIR/portable_stat_lib.sh"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$AUDIT"
}

pid_alive() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

heartbeat_mtime() {
  portable_stat '%m' '%Y' "$1"
}

probe_state() {
  local handoffd_pid="" supervisor_pid="" handoffd_alive="no" supervisor_alive="no"
  local status="(missing)" heartbeat="(missing)"

  [[ -f "$DAEMON_DIR/handoffd.pid" ]] && handoffd_pid="$(< "$DAEMON_DIR/handoffd.pid")"
  [[ -f "$DAEMON_DIR/handoffd-supervisor.pid" ]] && supervisor_pid="$(< "$DAEMON_DIR/handoffd-supervisor.pid")"
  pid_alive "$handoffd_pid" && handoffd_alive="yes"
  pid_alive "$supervisor_pid" && supervisor_alive="yes"
  [[ -f "$DAEMON_DIR/handoffd.status.json" ]] && status="$(cat "$DAEMON_DIR/handoffd.status.json")"
  [[ -f "$DAEMON_DIR/handoffd.heartbeat" ]] && heartbeat="$(heartbeat_mtime "$DAEMON_DIR/handoffd.heartbeat" 2>/dev/null || echo missing)"

  log "probe handoffd=$handoffd_pid alive=$handoffd_alive supervisor=$supervisor_pid alive=$supervisor_alive heartbeat_mtime=$heartbeat status=$status"
  [[ "$handoffd_alive" == "yes" && "$supervisor_alive" == "yes" ]]
}

mkdir -p "$DAEMON_DIR"
log "verify_daemon_lifecycle begin root=$ROOT SKIP_DAEMON=${SWARMFORGE_SKIP_DAEMON:-}"

if [[ "${SWARMFORGE_SKIP_DAEMON:-}" == "1" ]]; then
  log "SKIP_DAEMON=1 — daemon intentionally disabled"
  exit 0
fi

if ! probe_state; then
  log "daemon not healthy — invoking start_handoff_daemon.sh"
  if ! bash "$SCRIPT_DIR/start_handoff_daemon.sh" "$ROOT" 2>&1 | tee -a "$AUDIT"; then
    log "start_handoff_daemon.sh FAILED"
    "$SCRIPT_DIR/collect_daemon_postmortem.sh" "$ROOT" | tee -a "$AUDIT"
    exit 1
  fi
fi

attempt=0
while (( attempt < MAX_ATTEMPTS )); do
  attempt=$((attempt + 1))
  if probe_state; then
    log "verify_daemon_lifecycle SUCCESS after $attempt probe(s)"
    "$SCRIPT_DIR/collect_daemon_postmortem.sh" "$ROOT" | tee -a "$AUDIT"
    exit 0
  fi
  sleep 0.5
done

log "verify_daemon_lifecycle FAILED after $MAX_ATTEMPTS probes"
"$SCRIPT_DIR/collect_daemon_postmortem.sh" "$ROOT" | tee -a "$AUDIT"
exit 1
