#!/usr/bin/env bash
# Ordered handoffd startup: stop supervisor first, start handoffd, wait for
# pid-file ownership, then start the long-running supervisor loop. Avoids the
# BL-081 orphan reap race and BL-144 stalled-alarm during startup-notify.
set -euo pipefail

WORKING_DIR="${1:?usage: start_handoff_daemon.sh <project-root>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAEMON_DIR="$WORKING_DIR/.swarmforge/daemon"
HANDOFFD_LOG="$DAEMON_DIR/handoffd.log"
HANDOFFD_BB="${HANDOFFD_BB:-$SCRIPT_DIR/handoffd.bb}"
HANDOFFD_SUPERVISOR_BB="${HANDOFFD_SUPERVISOR_BB:-$SCRIPT_DIR/handoffd_supervisor.bb}"
PID_WAIT_ATTEMPTS="${PID_WAIT_ATTEMPTS:-60}"

if [[ "${SWARMFORGE_SKIP_DAEMON:-}" == "1" ]]; then
  echo "Skipping handoff daemon (SWARMFORGE_SKIP_DAEMON=1)."
  exit 0
fi

mkdir -p "$DAEMON_DIR"
AUDIT_LOG="$DAEMON_DIR/daemon-start-audit.log"

audit() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$AUDIT_LOG"
}

audit "start_handoff_daemon invoked root=$WORKING_DIR pid=$$ SKIP_DAEMON=${SWARMFORGE_SKIP_DAEMON:-} caller=${SWARMFORGE_DAEMON_START_CALLER:-unknown}"

stop_pid_file() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return 0
  fi
  local pid
  pid="$(< "$pid_file")"
  if [[ "$pid" =~ ^[0-9]+$ ]]; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}

# Supervisor first so it cannot reap a starting handoffd as an orphan.
stop_pid_file "$DAEMON_DIR/handoffd-supervisor.pid"
stop_pid_file "$DAEMON_DIR/handoffd.pid"
rm -f "$DAEMON_DIR/stop"

if [[ -f "$DAEMON_DIR/handoffd.status.json" ]]; then
  printf '%s\n' "{\"state\":\"healthy\",\"updated_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
    > "$DAEMON_DIR/handoffd.status.json"
fi

# BL-328: build identity (staleness detection) - a SEPARATE dedicated file,
# never a field merged into handoffd.status.json above, since that file is
# exclusively owned by handoffd_supervisor.bb's own read-modify-write cycle
# (a lost-update race between two writers is exactly what that ownership
# rule exists to prevent - see handoffd.bb's own header comment). Both
# daemons are launched together, right here, from the SAME git state, so
# one shared build_sha covers both - never a crash if git is unavailable,
# staleness detection just can't resolve this build.
HANDOFF_BUILD_SHA="$(git -C "$WORKING_DIR" rev-parse HEAD 2>/dev/null || true)"
printf '{"build_sha":"%s","started_at":"%s"}\n' "$HANDOFF_BUILD_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$DAEMON_DIR/handoffd-build.json"

if [[ -s "$HANDOFFD_LOG" ]]; then
  mv "$HANDOFFD_LOG" "$HANDOFFD_LOG.$(date -u +%Y%m%dT%H%M%SZ)"
fi

nohup bb "$HANDOFFD_BB" "$WORKING_DIR" >> "$HANDOFFD_LOG" 2>&1 &

claimed=0
for (( attempt = 1; attempt <= PID_WAIT_ATTEMPTS; attempt++ )); do
  if [[ -f "$DAEMON_DIR/handoffd.pid" ]]; then
    pid="$(< "$DAEMON_DIR/handoffd.pid")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      claimed=1
      break
    fi
  fi
  sleep 0.1
done

if [[ "$claimed" -ne 1 ]]; then
  audit "FAILED handoffd did not claim pid file under $DAEMON_DIR"
  echo "handoffd failed to claim handoffd.pid under $DAEMON_DIR" >&2
  exit 1
fi

audit "handoffd claimed pid=$(< "$DAEMON_DIR/handoffd.pid")"

nohup bb "$HANDOFFD_SUPERVISOR_BB" "$WORKING_DIR" >> "$DAEMON_DIR/handoffd-supervisor.log" 2>&1 &

supervisor_claimed=0
for (( attempt = 1; attempt <= PID_WAIT_ATTEMPTS; attempt++ )); do
  if [[ -f "$DAEMON_DIR/handoffd-supervisor.pid" ]]; then
    sup_pid="$(< "$DAEMON_DIR/handoffd-supervisor.pid")"
    if [[ "$sup_pid" =~ ^[0-9]+$ ]] && kill -0 "$sup_pid" 2>/dev/null; then
      supervisor_claimed=1
      break
    fi
  fi
  sleep 0.1
done

if [[ "$supervisor_claimed" -ne 1 ]]; then
  audit "FAILED supervisor did not claim pid file under $DAEMON_DIR"
  echo "handoffd supervisor failed to claim handoffd-supervisor.pid under $DAEMON_DIR" >&2
  exit 1
fi

audit "supervisor claimed pid=$(< "$DAEMON_DIR/handoffd-supervisor.pid")"
audit "SUCCESS handoffd+supervisor running"
echo "Started handoff daemon (pid $(< "$DAEMON_DIR/handoffd.pid")) and supervisor."
