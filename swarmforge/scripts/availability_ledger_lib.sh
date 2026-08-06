#!/bin/sh
# BL-823: append-only swarm availability interval ledger, shell write side.
#
# Two interval classes have no durable record today - control/cooldown
# pauses (a current-state marker resume overwrites) and stop-to-start gaps
# (a stop writes nothing). This lib is the shell twin of
# extension/src/metrics/availabilityLedgerStore.ts's appendAvailabilityRecord -
# same record shape ({ts,event,class,source}), same
# `.swarmforge/telemetry/availability-YYYY-MM.jsonl` convention. Sourced by
# kill_pipeline_swarm.sh (stop) and start-swarm.sh (start); the Babashka
# reader (availability_ledger_lib.bb) folds records from both writers plus
# the TS pause twins into intervals.
#
# POSIX sh only - sourced from bash stop/start scripts (same posture as
# freshness_stop_marker_lib.sh).

availability_ledger_dir() {
  # $1=root
  printf '%s/.swarmforge/telemetry' "$1"
}

availability_ledger_file() {
  # $1=root $2=month (YYYY-MM)
  printf '%s/availability-%s.jsonl' "$(availability_ledger_dir "$1")" "$2"
}

availability_now_iso() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

# Parse an ISO-8601 timestamp (optionally with fractional seconds) to unix
# epoch seconds. GNU/BSD date (same technique as
# daemon_log_freshness_check.sh's iso_to_epoch). Prints nothing and returns
# non-zero on failure - never dies, callers treat empty as "no usable
# evidence" rather than a guessed epoch.
availability_iso_to_epoch() {
  _aie_iso=$(printf '%s' "$1" | sed 's/\.[0-9]*Z$/Z/')
  if date -u -d "$_aie_iso" +%s 2>/dev/null; then
    return 0
  fi
  if date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$_aie_iso" +%s 2>/dev/null; then
    return 0
  fi
  return 1
}

_availability_json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# Append one transition record. NEVER fails the caller - a ledger write
# failure must never block, fail, or alter the pause/stop/start it observes
# (BL-823 invariant 1). Always returns 0.
#   $1=root $2=event(pause-start|pause-end|stop|start)
#   $3=class(control-pause|swarm-stop) $4=source $5=ts(optional, ISO-8601 UTC)
availability_record() {
  _ar_root=$1
  _ar_event=$2
  _ar_class=$3
  _ar_source=$4
  _ar_ts=${5:-$(availability_now_iso)}
  _ar_month=$(printf '%s' "$_ar_ts" | cut -c1-7)
  _ar_file=$(availability_ledger_file "$_ar_root" "$_ar_month")
  _ar_esc_source=$(_availability_json_escape "$_ar_source")
  (
    mkdir -p "$(dirname "$_ar_file")" &&
      printf '{"ts":"%s","event":"%s","class":"%s","source":"%s"}\n' \
        "$_ar_ts" "$_ar_event" "$_ar_class" "$_ar_esc_source" >> "$_ar_file"
  ) 2>/dev/null || true
  return 0
}

# Newest ledger file across month files (lexical sort == chronological,
# fixed YYYY-MM width), or empty if none exists.
availability_latest_ledger_file() {
  _alf_dir=$(availability_ledger_dir "$1")
  [ -d "$_alf_dir" ] || return 0
  find "$_alf_dir" -maxdepth 1 -name 'availability-*.jsonl' 2>/dev/null | sort | tail -n 1
}

# Last non-blank line of the newest ledger file, or empty.
availability_last_record_line() {
  _alrl_file=$(availability_latest_ledger_file "$1")
  [ -n "$_alrl_file" ] && [ -f "$_alrl_file" ] || return 0
  grep -v '^[[:space:]]*$' "$_alrl_file" 2>/dev/null | tail -n 1
}

# $1=line $2=field name - extracts "field":"value" (our writer's own fixed
# shape; not a general JSON parser).
_availability_field() {
  printf '%s' "$1" | sed -n 's/.*"'"$2"'":"\([^"]*\)".*/\1/p'
}

availability_last_event() {
  _ale_line=$(availability_last_record_line "$1")
  [ -n "$_ale_line" ] || return 0
  _availability_field "$_ale_line" event
}

# Timestamp of the most recent "start" record across every ledger file
# (newest month first), or empty if none exists.
availability_last_start_ts() {
  _alst_dir=$(availability_ledger_dir "$1")
  [ -d "$_alst_dir" ] || return 0
  for _alst_file in $(find "$_alst_dir" -maxdepth 1 -name 'availability-*.jsonl' 2>/dev/null | sort -r); do
    _alst_line=$(grep '"event":"start"' "$_alst_file" 2>/dev/null | tail -n 1 || true)
    if [ -n "$_alst_line" ]; then
      _availability_field "$_alst_line" ts
      return 0
    fi
  done
  return 0
}

# BL-823 point 3: at start, if the swarm's last recorded transition was not
# a graceful stop, close the still-open interval at the daemon's last
# heartbeat tick (an already-existing single-value file, handoffd.bb:2649)
# and mark it via source "heartbeat-inferred" - the reader tells this
# synthetic close apart from a real stop by that source, never a guessed
# timestamp field of its own. No usable heartbeat evidence (file missing,
# or no newer than the still-open interval's own start) emits nothing at
# all - that span falls back to wall clock, per BL-650's own safe
# direction. Always returns 0 - this is an observer, never a blocker.
#   $1=root $2=heartbeat-file-path
availability_close_ungraceful_stop() {
  _acus_root=$1
  _acus_heartbeat_file=$2
  _acus_last_event=$(availability_last_event "$_acus_root")
  [ -n "$_acus_last_event" ] || return 0
  [ "$_acus_last_event" = "stop" ] && return 0
  [ -f "$_acus_heartbeat_file" ] || return 0
  _acus_hb_ts=$(cat "$_acus_heartbeat_file" 2>/dev/null | tr -d '[:space:]')
  [ -n "$_acus_hb_ts" ] || return 0
  _acus_hb_epoch=$(availability_iso_to_epoch "$_acus_hb_ts") || return 0
  [ -n "$_acus_hb_epoch" ] || return 0
  _acus_last_start_ts=$(availability_last_start_ts "$_acus_root")
  if [ -n "$_acus_last_start_ts" ]; then
    _acus_start_epoch=$(availability_iso_to_epoch "$_acus_last_start_ts") || _acus_start_epoch=""
    if [ -n "$_acus_start_epoch" ] && [ "$_acus_hb_epoch" -le "$_acus_start_epoch" ]; then
      return 0
    fi
  fi
  availability_record "$_acus_root" "stop" "swarm-stop" "heartbeat-inferred" "$_acus_hb_ts"
  return 0
}
