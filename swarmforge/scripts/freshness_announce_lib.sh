#!/bin/sh
# BL-1414: per-(daemon,reason) announce-TRANSITION state, so a persisting
# violation is announced once, then digested at most once per window,
# instead of once per two-minute tick. On 2026-09-05 a real (if falsely
# triggered, BL-1413) five-daemon violation sent four Telegram messages a
# tick for ninety minutes; the shape recurs on any genuinely persistent
# violation, since every tick that still sees a violation announces today.
#
# Suppression is announce-ONLY: the durable incident record (BL-675's
# freshness-incidents.log) is appended by the caller on every tick exactly
# as before this ticket - this file decides only whether THAT tick's
# violation/recovery is ALSO worth a Telegram message.
#
# State lives one file per (daemon, reason) under
# .swarmforge/daemon/freshness-announce/ — never process memory (every cron
# tick is a fresh /bin/sh process, invariant 3). Shares no fate with any
# bb/node/swarm daemon: plain files, POSIX sh, sourced by the checker the
# same way freshness_stop_marker_lib.sh already is.

freshness_announce_state_dir() {
  # $1=root
  printf '%s/.swarmforge/daemon/freshness-announce' "$1"
}

freshness_announce_state_file() {
  # $1=root $2=daemon $3=reason — reason is always one of
  # heartbeat_age_secs's own fixed tokens (stale-heartbeat,
  # no-heartbeat-line, log-absent, unparseable-timestamp), already
  # filesystem-safe; no further sanitizing is done.
  printf '%s/%s__%s.state' "$(freshness_announce_state_dir "$1")" "$2" "$3"
}

_freshness_announce_field() {
  # $1=state-file $2=field-name — prints the numeric value or empty.
  [ -f "$1" ] || return 0
  sed -n "s/.*${2}=\\([0-9][0-9]*\\).*/\\1/p" "$1" | head -n 1
}

_freshness_announce_write() {
  # $1=root $2=daemon $3=reason $4=announced_epoch $5=suppressed $6=violation_started_epoch
  _faw_dir=$(freshness_announce_state_dir "$1")
  mkdir -p "$_faw_dir"
  printf 'announced_epoch=%s suppressed=%s violation_started_epoch=%s\n' "$4" "$5" "$6" \
    > "$(freshness_announce_state_file "$1" "$2" "$3")"
}

freshness_announce_clear_state() {
  # $1=root $2=daemon $3=reason
  rm -f "$(freshness_announce_state_file "$1" "$2" "$3")"
}

# Usage: announce_transition_only <root> <now> <digest_secs> <daemon> <reason> <action>
#   action is "restart" or "escalate" (still in violation this tick) or
#   "fresh" (this tick's age is at/under the effective threshold).
#
# Reads and updates the durable per-(daemon,reason) state and prints
# EXACTLY ONE decision line on stdout:
#   announce            - first tick of a new violation; always announce.
#   suppress            - a repeat tick inside the digest window; never announce.
#   digest <suppressed> - the digest window elapsed with the violation still
#                         live; announce one digest naming <suppressed> ticks
#                         that were folded into it, then the window restarts.
#   recovered <secs>    - the first fresh tick after a violation; announce
#                         recovery naming how long (<secs>) it was violating.
#   none                - a fresh tick with no violation on record; nothing
#                         to announce (BL-1414 scenario 04's "following
#                         fresh tick").
#
# BL-654 invariant 2: the FIRST tick of any transition — into violation, or
# back to fresh — is decided here as unconditionally "announce"/"recovered"
# before any window arithmetic runs, so no window default or override can
# ever suppress a first tick.
announce_transition_only() {
  _at_root=$1
  _at_now=$2
  _at_digest_secs=$3
  _at_daemon=$4
  _at_reason=$5
  _at_action=$6
  _at_state=$(freshness_announce_state_file "$_at_root" "$_at_daemon" "$_at_reason")

  if [ "$_at_action" = "fresh" ]; then
    if [ -f "$_at_state" ]; then
      _at_started=$(_freshness_announce_field "$_at_state" "violation_started_epoch")
      [ -n "$_at_started" ] || _at_started=$_at_now
      freshness_announce_clear_state "$_at_root" "$_at_daemon" "$_at_reason"
      printf 'recovered %s\n' "$((_at_now - _at_started))"
    else
      printf 'none\n'
    fi
    return 0
  fi

  # In violation this tick (action is restart or escalate).
  if [ ! -f "$_at_state" ]; then
    _freshness_announce_write "$_at_root" "$_at_daemon" "$_at_reason" "$_at_now" 0 "$_at_now"
    printf 'announce\n'
    return 0
  fi

  _at_announced=$(_freshness_announce_field "$_at_state" "announced_epoch")
  _at_suppressed=$(_freshness_announce_field "$_at_state" "suppressed")
  _at_started=$(_freshness_announce_field "$_at_state" "violation_started_epoch")
  [ -n "$_at_announced" ] || _at_announced=$_at_now
  [ -n "$_at_suppressed" ] || _at_suppressed=0
  [ -n "$_at_started" ] || _at_started=$_at_now

  _at_elapsed=$((_at_now - _at_announced))
  if [ "$_at_elapsed" -ge "$_at_digest_secs" ]; then
    _freshness_announce_write "$_at_root" "$_at_daemon" "$_at_reason" "$_at_now" 0 "$_at_started"
    printf 'digest %s\n' "$_at_suppressed"
    return 0
  fi

  _at_next=$((_at_suppressed + 1))
  _freshness_announce_write "$_at_root" "$_at_daemon" "$_at_reason" "$_at_announced" "$_at_next" "$_at_started"
  printf 'suppress\n'
}
