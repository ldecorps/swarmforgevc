#!/bin/sh
# BL-675: cron-side daemon log-freshness watchdog.
# POSIX sh + coreutils only (curl solely for announcing). Shares no fate with
# bb/node/swarm daemons — functions with every of those dead.
#
# For each watched daemon: assert the newest timestamped "heartbeat" log line
# is younger than that daemon's threshold. On violation: kill via pid file,
# restart via the daemon's OWN start script, append a durable incident record
# BEFORE any announce, then announce (Telegram curl by default).
#
# Env seams (tests inject all of these; production uses defaults):
#   FRESHNESS_ROOT           project root (required)
#   FRESHNESS_CONF           threshold/config file (default: alongside this script)
#   FRESHNESS_NOW_EPOCH      injected clock, unix seconds (default: date +%s)
#   FRESHNESS_INCIDENT_FILE  durable record path
#   FRESHNESS_COOL_OFF_SECS  restart cool-off window (default: 300)
#   FRESHNESS_ANNOUNCE_CMD   override announce; receives message as $1
#   FRESHNESS_KILL_CMD       override kill; receives pid as $1
#   FRESHNESS_START_CMD      override restart; receives start-script + root as $1 $2
#   FRESHNESS_EXTRA_PATH_DIRS  colon-separated dirs prepended to PATH (test seam;
#                              production default is a curated bin list, see below)
#   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID  for default announce
#
# BL-789 (2026-08-02 Mac host-switch hotfix): cron's own PATH is
# /usr/bin:/bin, missing bb/node, so a restart's `nohup bb ...` failed with
# "bb: No such file or directory" and the daemon was reported down forever.
# We establish our OWN PATH here (exported, so every child this script
# spawns - kill/start commands - inherits it too) rather than trusting
# whatever PATH cron/the caller happened to have.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck disable=SC1091
. "$SCRIPT_DIR/freshness_stop_marker_lib.sh"
FRESHNESS_EXTRA_PATH_DIRS=${FRESHNESS_EXTRA_PATH_DIRS:-"/usr/local/bin:/opt/homebrew/bin:${HOME:-}/.local/bin:${HOME:-}/.npm-global/bin"}
PATH="${FRESHNESS_EXTRA_PATH_DIRS}:${PATH:-/usr/bin:/bin}"
export PATH
ROOT=${FRESHNESS_ROOT:?FRESHNESS_ROOT is required}
CONF=${FRESHNESS_CONF:-"$SCRIPT_DIR/daemon_log_freshness.conf"}
NOW=${FRESHNESS_NOW_EPOCH:-$(date +%s)}
COOL_OFF=${FRESHNESS_COOL_OFF_SECS:-300}
INCIDENT_FILE=${FRESHNESS_INCIDENT_FILE:-"$ROOT/.swarmforge/daemon/freshness-incidents.log"}

mkdir -p "$(dirname -- "$INCIDENT_FILE")"

# Parse ISO-8601 / ISO_INSTANT prefix (...Z) to unix epoch. Busybox/GNU date.
iso_to_epoch() {
  iso=$1
  # Strip fractional seconds if present: 2026-07-28T12:00:00.123Z -> ...00Z
  iso=$(printf '%s' "$iso" | sed 's/\.[0-9]*Z$/Z/')
  if date -u -d "$iso" +%s >/dev/null 2>&1; then
    date -u -d "$iso" +%s
    return
  fi
  # BSD/macOS
  if date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$iso" +%s >/dev/null 2>&1; then
    date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$iso" +%s
    return
  fi
  printf '%s\n' "0"
}

# Newest heartbeat line age in seconds, or a huge number if none/unparseable.
heartbeat_age_secs() {
  log_path=$1
  if [ ! -f "$log_path" ]; then
    printf '%s\n' "999999999"
    return
  fi
  # Last line containing the token "heartbeat" (content-free pulse).
  line=$(grep -E '[[:space:]]heartbeat([[:space:]]|$)' "$log_path" | tail -n 1 || true)
  if [ -z "$line" ]; then
    printf '%s\n' "999999999"
    return
  fi
  ts=$(printf '%s' "$line" | awk '{print $1}')
  epoch=$(iso_to_epoch "$ts")
  if [ -z "$epoch" ] || [ "$epoch" -eq 0 ]; then
    printf '%s\n' "999999999"
    return
  fi
  printf '%s\n' $((NOW - epoch))
}

last_restart_epoch() {
  daemon=$1
  if [ ! -f "$INCIDENT_FILE" ]; then
    printf '%s\n' "0"
    return
  fi
  line=$(grep "daemon=${daemon}" "$INCIDENT_FILE" | grep 'action=restart' | tail -n 1 || true)
  if [ -z "$line" ]; then
    printf '%s\n' "0"
    return
  fi
  epoch=$(printf '%s' "$line" | sed -n 's/.*epoch=\([0-9][0-9]*\).*/\1/p')
  if [ -z "$epoch" ]; then
    printf '%s\n' "0"
    return
  fi
  printf '%s\n' "$epoch"
}

append_incident() {
  # Append BEFORE any announce attempt — durable even if announce fails.
  printf '%s\n' "$1" >> "$INCIDENT_FILE"
}

default_announce() {
  msg=$1
  token=${TELEGRAM_BOT_TOKEN:-}
  chat=${TELEGRAM_CHAT_ID:-}
  if [ -z "$token" ] || [ -z "$chat" ]; then
    printf '%s\n' "freshness_check: announce skipped (TELEGRAM_* unset): $msg" >&2
    return 1
  fi
  # Grep-able for BL-653 escalation composition: FRESHNESS_VIOLATION
  curl -sS -X POST "https://api.telegram.org/bot${token}/sendMessage" \
    --data-urlencode "chat_id=${chat}" \
    --data-urlencode "text=${msg}" \
    >/dev/null
}

do_announce() {
  msg=$1
  if [ -n "${FRESHNESS_ANNOUNCE_CMD:-}" ]; then
    # shellcheck disable=SC2086
    sh -c "$FRESHNESS_ANNOUNCE_CMD" _ "$msg" || true
    return 0
  fi
  default_announce "$msg" || true
}

kill_daemon() {
  pid_file=$1
  if [ ! -f "$pid_file" ]; then
    return 0
  fi
  pid=$(tr -d '[:space:]' < "$pid_file" || true)
  case "$pid" in
    ''|*[!0-9]*) return 0 ;;
  esac
  # Never target pid 1 or the checker itself.
  if [ "$pid" -eq 1 ] || [ "$pid" -eq "$$" ]; then
    printf '%s\n' "freshness_check: refusing to kill protected pid=$pid" >&2
    return 1
  fi
  if [ -n "${FRESHNESS_KILL_CMD:-}" ]; then
    # shellcheck disable=SC2086
    sh -c "$FRESHNESS_KILL_CMD" _ "$pid" || true
    return 0
  fi
  kill -TERM "$pid" 2>/dev/null || true
}

restart_daemon() {
  start_script=$1
  if [ -n "${FRESHNESS_START_CMD:-}" ]; then
    sh -c "$FRESHNESS_START_CMD" _ "$start_script" "$ROOT" || true
    return 0
  fi
  if [ -x "$start_script" ]; then
    "$start_script" "$ROOT" || true
  else
    sh "$start_script" "$ROOT" || true
  fi
}

process_daemon() {
  name=$1
  threshold=$2
  log_rel=$3
  pid_rel=$4
  start_name=$5

  # BL-785: a deliberate stop (kill_pipeline_swarm.sh for handoffd,
  # stop_ancillary_services.sh for babysitterd) leaves this daemon watched
  # but suppressed - a stale heartbeat is the expected, intentional state,
  # not a violation. Checked first and from durable state alone, so the
  # verdict holds with every bb/node/swarm process dead.
  if freshness_is_stopped "$ROOT" "$name"; then
    return 0
  fi

  # BL-789: babysitterd deliberately never started this session
  # (SWARMFORGE_SKIP_BABYSITTERD=1, the same var start_ancillary_services.sh
  # honours) leaves no stop-marker above - nothing ever ran to stop. Without
  # this, cron restarted a daemon nobody wanted running every cool-off
  # window and warned each time. This is a SEPARATE predicate from
  # freshness_is_stopped on purpose: that one records an explicit runtime
  # stop event (a process that ran and was told to stop); this one is a
  # launch-time policy readable with no process ever having run at all -
  # different moments in the daemon's lifecycle, both must be consulted.
  if [ "$name" = "babysitterd" ] && [ "${SWARMFORGE_SKIP_BABYSITTERD:-}" = "1" ]; then
    return 0
  fi

  log_path="$ROOT/$log_rel"
  pid_path="$ROOT/$pid_rel"
  start_script="$SCRIPT_DIR/$start_name"

  age=$(heartbeat_age_secs "$log_path")
  if [ "$age" -le "$threshold" ]; then
    return 0
  fi

  last=$(last_restart_epoch "$name")
  since=$((NOW - last))
  if [ "$last" -gt 0 ] && [ "$since" -lt "$COOL_OFF" ]; then
    record="epoch=${NOW} daemon=${name} age_secs=${age} threshold=${threshold} action=escalate cool_off_remaining=$((COOL_OFF - since))"
    append_incident "$record"
    do_announce "FRESHNESS_VIOLATION escalate daemon=${name} age_secs=${age} threshold=${threshold} (cool-off; no second restart)"
    return 0
  fi

  kill_daemon "$pid_path" || true
  restart_daemon "$start_script"
  record="epoch=${NOW} daemon=${name} age_secs=${age} threshold=${threshold} action=restart"
  append_incident "$record"
  do_announce "FRESHNESS_VIOLATION restart daemon=${name} age_secs=${age} threshold=${threshold}"
}

# Load project + telegram env files when present (production cron path).
# BL-789: swarm.env is where a normal swarm start sets
# SWARMFORGE_SKIP_BABYSITTERD - cron starts with none of this operator's
# shell env, so without loading it here the skip could only ever be seen
# via an already-exported var, never the file a real swarm start writes.
for env_file in \
  "$ROOT/.swarmforge/telegram.env" \
  "$ROOT/.swarmforge/operator/telegram.env" \
  "$ROOT/.swarmforge/swarm.env"; do
  if [ -f "$env_file" ]; then
    # shellcheck disable=SC1090
    set -a
    # POSIX: `.` not `source`
    . "$env_file"
    set +a
  fi
done

if [ ! -f "$CONF" ]; then
  printf '%s\n' "freshness_check: missing conf $CONF" >&2
  exit 1
fi

while IFS='|' read -r name threshold log_rel pid_rel start_name || [ -n "${name:-}" ]; do
  case "$name" in
    ''|\#*) continue ;;
  esac
  process_daemon "$name" "$threshold" "$log_rel" "$pid_rel" "$start_name"
done < "$CONF"

exit 0
