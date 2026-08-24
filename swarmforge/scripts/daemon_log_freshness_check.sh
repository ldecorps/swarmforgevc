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
#   FRESHNESS_LOAD           BL-1012 injected load average (default: read from
#                            the host). With FRESHNESS_CORES below this pins
#                            the contention factor deterministically.
#   FRESHNESS_CORES          BL-1012 injected core count (default: read from
#                            the host)
#   FRESHNESS_MAX_THRESHOLD_SECS  BL-1012 ceiling on the effective threshold
#                            (default: 600 - the bound babysitterd already
#                            carries in this very conf)
#   FRESHNESS_RESTART_GRACE  BL-1012 post-restart grace window in which an
#                            absent/heartbeat-less log is not a violation,
#                            because our own restart rotated it away
#                            (default: 300)
#   FRESHNESS_ANNOUNCE_CMD   override announce; receives message as $1
#   FRESHNESS_KILL_CMD       override kill; receives pid as $1
#   FRESHNESS_START_CMD      override restart; receives start-script + root as $1 $2
#   FRESHNESS_EXTRA_PATH_DIRS  colon-separated dirs prepended to PATH (test seam;
#                              production default is a curated bin list, see below)
#   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID  for default announce
#   SWARMFORGE_FLEET_HOME / HOME + swarm-identity  fleet telegram.json
#                              fallback when those vars are still empty
#                              after loading *.env (BL-436 creds live in
#                              ~/.swarmforge/fleet/<swarm>/telegram.json,
#                              never in the tree)
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
# shellcheck disable=SC1091
. "$SCRIPT_DIR/freshness_announce_normalize_lib.sh"
FRESHNESS_EXTRA_PATH_DIRS=${FRESHNESS_EXTRA_PATH_DIRS:-"/usr/local/bin:/opt/homebrew/bin:${HOME:-}/.local/bin:${HOME:-}/.npm-global/bin"}
PATH="${FRESHNESS_EXTRA_PATH_DIRS}:${PATH:-/usr/bin:/bin}"
export PATH
# BL-796: layer node resolution (including nvm-only node) on top of the
# curated PATH above via the ONE shared resolver start_handoff_daemon.sh and
# install_freshness_cron.sh also use - a restart's `nohup bb ...` finding bb
# here but not node fails identically to the BL-789 fault this file already
# guards against.
# shellcheck disable=SC1091
. "$SCRIPT_DIR/operator_path_lib.sh"
swarmforge_prepend_operator_bins
ROOT=${FRESHNESS_ROOT:?FRESHNESS_ROOT is required}
CONF=${FRESHNESS_CONF:-"$SCRIPT_DIR/daemon_log_freshness.conf"}
NOW=${FRESHNESS_NOW_EPOCH:-$(date +%s)}
COOL_OFF=${FRESHNESS_COOL_OFF_SECS:-300}
MAX_THRESHOLD=${FRESHNESS_MAX_THRESHOLD_SECS:-600}
RESTART_GRACE=${FRESHNESS_RESTART_GRACE:-300}
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

# BL-1012: host contention as an integer factor, load average / core count,
# floored at 1. The fixed 120s threshold encoded an assumption about
# contention that nothing recorded and nothing rechecked: on 2026-08-21 the
# Mac sat at load 80 on four cores with a single chase sweep taking 17s, and
# the watchdog killed handoffd nine times for ages of 132-350s - late, not
# hung, and restarted mid-cycle for it.
#
# Anything unreadable or unparseable falls back to 1, which reproduces
# today's behaviour EXACTLY on a quiet box: this never raises the threshold
# at factor 1, so a genuinely hung daemon still reds in two minutes there.
# Integer division truncates, which rounds the window DOWN - the conservative
# direction, and the reason a sub-1 result is floored rather than rejected.
read_load_average() {
  if [ -n "${FRESHNESS_LOAD:-}" ]; then
    printf '%s\n' "$FRESHNESS_LOAD"
    return
  fi
  if [ -r /proc/loadavg ]; then
    awk '{print $1}' /proc/loadavg 2>/dev/null && return
  fi
  # BSD/macOS: "{ 80.53 42.11 30.00 }"
  sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}' && return
  printf '%s\n' ""
}

read_core_count() {
  if [ -n "${FRESHNESS_CORES:-}" ]; then
    printf '%s\n' "$FRESHNESS_CORES"
    return
  fi
  nproc 2>/dev/null && return
  sysctl -n hw.ncpu 2>/dev/null && return
  printf '%s\n' ""
}

contention_factor() {
  load=$(read_load_average 2>/dev/null || true)
  cores=$(read_core_count 2>/dev/null || true)
  # Integer part only - POSIX sh has no floating point.
  load_int=$(printf '%s' "$load" | sed -n 's/^\([0-9][0-9]*\).*$/\1/p')
  cores_int=$(printf '%s' "$cores" | sed -n 's/^\([0-9][0-9]*\).*$/\1/p')
  if [ -z "$load_int" ] || [ -z "$cores_int" ] || [ "$cores_int" -le 0 ]; then
    printf '%s\n' "1"
    return
  fi
  factor=$((load_int / cores_int))
  if [ "$factor" -lt 1 ]; then
    factor=1
  fi
  printf '%s\n' "$factor"
}

# BL-1012 invariant 1 - BOUNDED. An arbitrarily loaded host never earns an
# arbitrarily long window: past the ceiling a genuinely dead daemon is always
# caught, however contended the box.
effective_threshold() {
  base=$1
  factor=$2
  eff=$((base * factor))
  if [ "$eff" -gt "$MAX_THRESHOLD" ]; then
    eff=$MAX_THRESHOLD
  fi
  printf '%s\n' "$eff"
}

# Newest heartbeat line age in seconds, or a huge number if none/unparseable.
# BL-1011: prints "<age> <reason>". The age keeps its historical shape - the
# 999999999 sentinel still comes back for the three unmeasurable conditions, so
# every numeric comparison downstream (the BL-1012 grace check especially)
# keeps working byte-for-byte. What is NEW is the second field: which of the
# three conditions produced it, so a human never has to decode a number.
#
# The sentinel is an INTERNAL value from here on. Nothing may print it to a
# person - render_age below is the only thing that turns an age into text.
SENTINEL_AGE=999999999

heartbeat_age_secs() {
  log_path=$1
  if [ ! -f "$log_path" ]; then
    printf '%s %s\n' "$SENTINEL_AGE" "log-absent"
    return
  fi
  # Last line containing the token "heartbeat" (content-free pulse).
  line=$(grep -E '[[:space:]]heartbeat([[:space:]]|$)' "$log_path" | tail -n 1 || true)
  if [ -z "$line" ]; then
    printf '%s %s\n' "$SENTINEL_AGE" "no-heartbeat-line"
    return
  fi
  ts=$(printf '%s' "$line" | awk '{print $1}')
  epoch=$(iso_to_epoch "$ts")
  if [ -z "$epoch" ] || [ "$epoch" -eq 0 ]; then
    printf '%s %s\n' "$SENTINEL_AGE" "unparseable-timestamp"
    return
  fi
  printf '%s %s\n' $((NOW - epoch)) "stale-heartbeat"
}

# BL-1011: a value that is not an age never renders as a number. This is the
# single place an age becomes human-facing text, so there is one place to be
# right rather than four interpolation sites to keep in step.
render_age() {
  if [ "$1" -eq "$SENTINEL_AGE" ]; then
    printf '%s\n' "unknown"
  else
    printf '%s\n' "$1"
  fi
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
  raw=$1
  msg=$(normalize_telegram_plain_text "$raw")
  if [ "$msg" != "$raw" ]; then
    printf '%s\n' "freshness_check: normalized non-ASCII whitespace in announce" >&2
  fi
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

  # BL-1011: "<age> <reason>". `age` keeps its old numeric meaning (sentinel
  # included) so every comparison below is unchanged; `reason` is what a human
  # reads instead of the sentinel.
  age_and_reason=$(heartbeat_age_secs "$log_path")
  age=${age_and_reason%% *}
  reason=${age_and_reason#* }

  # BL-1012: the threshold is now relative to host contention, within a hard
  # ceiling. At factor 1 this is byte-for-byte today's behaviour.
  factor=$(contention_factor)
  effective=$(effective_threshold "$threshold" "$factor")

  if [ "$age" -le "$effective" ]; then
    return 0
  fi

  last=$(last_restart_epoch "$name")
  since=$((NOW - last))

  # BL-1012 invariant 2 - NEVER ACT ON EVIDENCE WE DESTROYED.
  # start_handoff_daemon.sh moves handoffd.log aside on every start, and the
  # checker restarts through that same script. So right after a restart WE
  # performed, the log the next check reads is one our own restart rotated
  # away and heartbeat_age_secs returns its file-absent sentinel. Alarming on
  # that is alarming on our own footprint - and if the restart failed to
  # bring the daemon up, it would repeat every two minutes forever with
  # nothing left to diagnose from.
  #
  # Scoped deliberately to the SENTINEL only (absent log / no heartbeat line),
  # never to a real measured age: a daemon that came back up and then went
  # stale inside the grace window is a genuine violation and must still fire.
  if [ "$age" -eq "$SENTINEL_AGE" ] && [ "$last" -gt 0 ] && [ "$since" -lt "$RESTART_GRACE" ]; then
    record="epoch=${NOW} swarm=${SWARM_NAME} daemon=${name} age_secs=$(render_age "$age") reason=${reason} threshold=${threshold} effective_threshold=${effective} contention_factor=${factor} action=grace grace_remaining=$((RESTART_GRACE - since))"
    append_incident "$record"
    return 0
  fi

  if [ "$last" -gt 0 ] && [ "$since" -lt "$COOL_OFF" ]; then
    record="epoch=${NOW} swarm=${SWARM_NAME} daemon=${name} age_secs=$(render_age "$age") reason=${reason} threshold=${threshold} effective_threshold=${effective} contention_factor=${factor} action=escalate cool_off_remaining=$((COOL_OFF - since))"
    append_incident "$record"
    do_announce "FRESHNESS_VIOLATION escalate swarm=${SWARM_NAME} daemon=${name} age_secs=$(render_age "$age") reason=${reason} threshold=${effective} (cool-off; no second restart)"
    return 0
  fi

  kill_daemon "$pid_path" || true
  restart_daemon "$start_script"
  # BL-1012 invariant 3 - ATTRIBUTABLE. The record names the effective
  # threshold AND the contention factor that produced it, so a past decision
  # is interpretable from the record alone and never needs re-running at the
  # same load to classify. `threshold=` stays the BASE, unchanged, so every
  # existing reader of these records keeps working.
  record="epoch=${NOW} swarm=${SWARM_NAME} daemon=${name} age_secs=$(render_age "$age") reason=${reason} threshold=${threshold} effective_threshold=${effective} contention_factor=${factor} action=restart"
  append_incident "$record"
  do_announce "FRESHNESS_VIOLATION restart swarm=${SWARM_NAME} daemon=${name} age_secs=$(render_age "$age") reason=${reason} threshold=${effective}"
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

# Fleet creds: cron inherits none of the operator shell's TELEGRAM_*, and
# a normal primary never copies the bot token into telegram.env (secrets
# stay in ~/.swarmforge/fleet/<swarm>/telegram.json). Env files above win
# when they already set the vars; this only fills the gap.
json_field() {
  file=$1
  key=$2
  [ -f "$file" ] || return 0
  sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$file" | head -n 1
}
json_number() {
  file=$1
  key=$2
  [ -f "$file" ] || return 0
  sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\\(-*[0-9][0-9]*\\).*/\\1/p" "$file" | head -n 1
}
# BL-1011: resolve this checkout's own swarm name UNCONDITIONALLY. It used to
# be computed only inside the credential-fallback branch below, so a checkout
# whose TELEGRAM_* were already exported never computed it and announced
# anonymously - which is exactly why the five alarms of 2026-08-21 could not be
# attributed to any host. Attribution must not depend on which credential path
# supplied the token.
resolve_swarm_name() {
  swarm_name=${SWARMFORGE_SWARM_NAME:-}
  if [ -z "$swarm_name" ] && [ -f "$ROOT/.swarmforge/swarm-identity" ]; then
    swarm_name=$(awk -F '\t' '$1=="swarm_name" {print $2; exit}' "$ROOT/.swarmforge/swarm-identity" || true)
  fi
  # Never empty: an unattributable alarm is the defect. Falls back to the same
  # default swarm_identity_lib.bb uses.
  [ -n "$swarm_name" ] || swarm_name=primary
  printf '%s\n' "$swarm_name"
}
SWARM_NAME=$(resolve_swarm_name)

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  swarm_name=$SWARM_NAME
  fleet_home=${SWARMFORGE_FLEET_HOME:-${HOME:-}}
  fleet_json="$fleet_home/.swarmforge/fleet/$swarm_name/telegram.json"
  if [ -f "$fleet_json" ]; then
    [ -n "${TELEGRAM_BOT_TOKEN:-}" ] || TELEGRAM_BOT_TOKEN=$(json_field "$fleet_json" "botToken")
    [ -n "${TELEGRAM_CHAT_ID:-}" ] || TELEGRAM_CHAT_ID=$(json_field "$fleet_json" "chatId")
    [ -n "${TELEGRAM_CHAT_ID:-}" ] || TELEGRAM_CHAT_ID=$(json_number "$fleet_json" "chatId")
    export TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID
  fi
fi

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
