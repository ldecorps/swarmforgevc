#!/usr/bin/env bash
# Ordered handoffd startup: stop supervisor first, start handoffd, wait for
# pid-file ownership, then start the long-running supervisor loop. Avoids the
# BL-081 orphan reap race and BL-144 stalled-alarm during startup-notify.
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/lifecycle_help_lib.sh"
  print_lifecycle_help "start_handoff_daemon.sh" "lifecycle start entry point."
  exit 0
fi


WORKING_DIR="${1:?usage: start_handoff_daemon.sh <project-root>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/freshness_stop_marker_lib.sh"
# BL-796: prepend resolved bb/node (including nvm-only node) onto PATH
# before anything below launches handoffd - a cron/minimal-PATH invocation
# that finds bb but not node fails every node-driven sweep silently (BL-789
# found bb missing; node was the still-missing half).
# shellcheck disable=SC1091
source "$SCRIPT_DIR/operator_path_lib.sh"
swarmforge_prepend_operator_bins
DAEMON_DIR="$WORKING_DIR/.swarmforge/daemon"
HANDOFFD_LOG="$DAEMON_DIR/handoffd.log"
HANDOFFD_BB="${HANDOFFD_BB:-$SCRIPT_DIR/handoffd.bb}"
HANDOFFD_SUPERVISOR_BB="${HANDOFFD_SUPERVISOR_BB:-$SCRIPT_DIR/handoffd_supervisor.bb}"
PID_WAIT_ATTEMPTS="${PID_WAIT_ATTEMPTS:-60}"

# BL-1548: audit the invocation before honouring SWARMFORGE_SKIP_DAEMON - a
# skipped start request is still a start request, and the ledger this log
# keeps must see it, or a postmortem reading the log can't tell a skip
# apart from an invocation that never happened at all.
mkdir -p "$DAEMON_DIR"
AUDIT_LOG="$DAEMON_DIR/daemon-start-audit.log"

audit() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$AUDIT_LOG"
}

audit "start_handoff_daemon invoked root=$WORKING_DIR pid=$$ SKIP_DAEMON=${SWARMFORGE_SKIP_DAEMON:-} caller=${SWARMFORGE_DAEMON_START_CALLER:-unknown}"

if [[ "${SWARMFORGE_SKIP_DAEMON:-}" == "1" ]]; then
  audit "skipping: SWARMFORGE_SKIP_DAEMON=1"
  echo "Skipping handoff daemon (SWARMFORGE_SKIP_DAEMON=1)."
  exit 0
fi

# BL-1688: a deliberate launch (./swarm, CALLER=swarmforge.sh) still clears
# every deliberate-stop signal below - starting re-arms watching (BL-785).
# Any OTHER caller (the freshness cron checker's build_freshness_cli, the
# supervisor's own restart ladder, or an unset/unknown caller) is a HEAL
# path, not a launch, and must not resurrect a daemon stopped on purpose -
# refuse while the marker stands, before touching anything at all (2026-09-21:
# 334 such heal-path restarts in 44 minutes into a missing tmux socket, see
# this ticket's own evidence).
DAEMON_START_CALLER="${SWARMFORGE_DAEMON_START_CALLER:-unknown}"
if [[ "$DAEMON_START_CALLER" != "swarmforge.sh" ]] && freshness_is_stopped "$WORKING_DIR" "handoffd"; then
  audit "REFUSED handoffd.stopped marker present - deliberate stop; a launch clears it"
  exit 1
fi

# BL-785: starting re-arms watching — a deliberate stop must not outlive the
# next start, or the crontab line would be present while the daemon it
# watches is silently unwatched.
freshness_clear_stopped "$WORKING_DIR" "handoffd"

# BL-976: a relaunch from a keyless shell (the supervisor/watchdog chain
# spawns generations from whatever environment happens to run it) must not
# silently lose email capability - re-source the operator's env file into
# THIS launch environment so both daemons below inherit it. The file is
# operator-created, lives under gitignored .swarmforge/ runtime state, and
# is never committed (BL-215 posture unchanged); only its PATH is audited,
# never any value it defines. No file -> ambient env only, behavior
# unchanged.
OPERATOR_ENV_FILE="$WORKING_DIR/.swarmforge/operator/daemon.env"
if [[ -f "$OPERATOR_ENV_FILE" ]]; then
  audit "sourcing operator env file $OPERATOR_ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$OPERATOR_ENV_FILE"
  set +a
else
  audit "no operator env file at $OPERATOR_ENV_FILE (ambient env only)"
fi

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

# BL-1688: read-merge-write, never a blind overwrite - the prior shape
# erased :restart_history on every invocation, so BL-1492's restart-budget
# ledger could never accumulate past one entry (whichever caller started
# the daemon LAST wiped out what the other had just written; 166 of 325
# failure reports on 2026-09-21 read restart_history: nil, the rest never
# more than one entry). Every OTHER field the status file carries survives
# untouched; only state/updated_at are ours to set here.
if [[ -f "$DAEMON_DIR/handoffd.status.json" ]]; then
  python3 - "$DAEMON_DIR/handoffd.status.json" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" <<'PYEOF'
import json
import sys

path, updated_at = sys.argv[1], sys.argv[2]
try:
    with open(path) as f:
        status = json.load(f)
    if not isinstance(status, dict):
        status = {}
except Exception:
    status = {}
status["state"] = "healthy"
status["updated_at"] = updated_at
with open(path, "w") as f:
    json.dump(status, f)
    f.write("\n")
PYEOF
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
