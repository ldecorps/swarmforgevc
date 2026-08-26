#!/usr/bin/env bash
# BL-993 invariant 2 gate ("a restart is never silent"), added for the
# 2026-08-21 architect bounce (backlog/evidence/
# BL-993-bounce-20260821-architect.md): every prior layer checked a
# hand-copied announced-events literal against another copy of itself and
# never exercised the REAL announce path, so a supervisor that silently
# swallowed its own give-up escalation stayed green everywhere. This test
# closes that hole the way test_swarm_ensure.sh's RC-8 does for
# SWARM_ENSURE_RC_NOTIFY_CMD: it runs the REAL operator_runtime_supervisor.bb
# (--check-once) with OPERATOR_WATCH_NOTIFY_CMD pointed at a capture script,
# drives it through reachable check-one! events, and asserts on what the
# capture file actually received.
#
# Usage:
#   bl993_announce_matches_predicate.sh --all
#       Drive all 6 reachable events (:started/:crashed/:healthy-reset/
#       :gave-up/:re-armed/nil). For each, the EXPECTED announced-ness is
#       queried live from operator_runtime_watch_lib.bb's announced-event?
#       (the single source of truth), never from a list kept in this file -
#       so the assertion is real-behavior-vs-real-predicate, with no third
#       hand copy to drift.
#   bl993_announce_matches_predicate.sh <mode>
#       Drive one event and report; the caller owns the announced-ness
#       assertion (the BL-993 acceptance steps use these modes so scenarios
#       01/02/04 assert against the real announce path, not a mirrored set).
#       Modes: started-no-pidfile | started-dead-pidfile |
#              started-unrelated-pid | healthy | crashed | healthy-reset |
#              gave-up | re-armed
#       Prints: EVENT_OBSERVED=<tag|none>, ANNOUNCE_COUNT=<n>,
#               ANNOUNCED=<true|false>, TEXT=<first captured line>
#       Exits non-zero when the drive did not produce the intended event.
#
# Real-process convention per bl993_watch_survives_runtime_death.sh: real bb
# supervisor, real fixture "operator" process where liveness matters (a bb
# process with operator_runtime.bb as a literal arg - ProcessHandle reads the
# real argv), everything rooted in per-drive mktemp dirs removed on EXIT.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPERVISOR_BB="$SCRIPT_DIR/../operator_runtime_supervisor.bb"
WATCH_LIB="$SCRIPT_DIR/../operator_runtime_watch_lib.bb"

# The watch must see a genuinely "expected to be running" world regardless
# of the invoking shell's own swarm state.
unset SWARMFORGE_SKIP_OPERATOR 2>/dev/null || true

ROOTS=""
SPAWNED_PIDS=""
cleanup() {
  for p in $SPAWNED_PIDS; do
    kill -0 "$p" 2>/dev/null && kill -TERM "$p" 2>/dev/null
  done
  for r in $ROOTS; do
    rm -rf "$r"
  done
}
trap cleanup EXIT

make_dead_pid() {
  ( : ) &
  DEAD_PID=$!
  wait "$DEAD_PID" 2>/dev/null || true
}

# drive_event <mode>: fresh root, fixture per mode, one --check-once run.
# Sets: OBSERVED_OK (0/1 shell rc semantics via return), ANNOUNCE_COUNT,
# ANNOUNCED, TEXT, DRIVE_LOG.
drive_event() {
  mode="$1"
  ROOT="$(mktemp -d)"
  ROOTS="$ROOTS $ROOT"
  OP_DIR="$ROOT/.swarmforge/operator"
  mkdir -p "$OP_DIR"
  CAP="$ROOT/announce-capture.txt"
  NOTIFY="$ROOT/notify_capture.sh"
  cat > "$NOTIFY" <<EOF
#!/bin/sh
printf '%s\n' "\$1" >> "$CAP"
EOF
  chmod +x "$NOTIFY"
  DRIVE_LOG="$OP_DIR/operator-runtime-supervisor.log"

  intended_tag=""
  case "$mode" in
    started-no-pidfile)
      intended_tag="started"
      ;;
    started-dead-pidfile)
      intended_tag="started"
      make_dead_pid
      echo "$DEAD_PID" > "$OP_DIR/runtime.pid"
      ;;
    started-unrelated-pid)
      intended_tag="started"
      sleep 60 &
      UNREL_PID=$!
      SPAWNED_PIDS="$SPAWNED_PIDS $UNREL_PID"
      echo "$UNREL_PID" > "$OP_DIR/runtime.pid"
      ;;
    healthy)
      intended_tag=""
      bb -e '(Thread/sleep 60000)' operator_runtime.bb &
      FAKE_PID=$!
      SPAWNED_PIDS="$SPAWNED_PIDS $FAKE_PID"
      echo "$FAKE_PID" > "$OP_DIR/runtime.pid"
      sleep 0.3
      ;;
    crashed)
      intended_tag="crashed"
      make_dead_pid
      printf '{"state":"running","reason":null,"entry":{"pid":%s,"attempts":0,"status":"running","crashed-at-ms":null,"started-at-ms":1,"gave-up-at-ms":null},"updated_at":"seed"}\n' \
        "$DEAD_PID" > "$OP_DIR/operator-runtime-supervisor.status.json"
      ;;
    healthy-reset)
      intended_tag="healthy-reset"
      bb -e '(Thread/sleep 60000)' operator_runtime.bb &
      FAKE_PID=$!
      SPAWNED_PIDS="$SPAWNED_PIDS $FAKE_PID"
      echo "$FAKE_PID" > "$OP_DIR/runtime.pid"
      sleep 0.3
      printf '{"state":"running","reason":null,"entry":{"pid":%s,"attempts":2,"status":"running","crashed-at-ms":null,"started-at-ms":1,"gave-up-at-ms":null},"updated_at":"seed"}\n' \
        "$FAKE_PID" > "$OP_DIR/operator-runtime-supervisor.status.json"
      ;;
    gave-up)
      intended_tag="gave-up"
      printf '{"state":"waiting","reason":null,"entry":{"pid":null,"attempts":5,"status":"waiting","crashed-at-ms":1,"started-at-ms":null,"gave-up-at-ms":null},"updated_at":"seed"}\n' \
        > "$OP_DIR/operator-runtime-supervisor.status.json"
      ;;
    re-armed)
      intended_tag="re-armed"
      printf '{"state":"gave-up","reason":null,"entry":{"pid":null,"attempts":5,"status":"gave-up","crashed-at-ms":null,"started-at-ms":null,"gave-up-at-ms":1},"updated_at":"seed"}\n' \
        > "$OP_DIR/operator-runtime-supervisor.status.json"
      ;;
    *)
      echo "FAIL: unknown mode '$mode'" >&2
      return 1
      ;;
  esac

  # The seeded entries assume the default bound of 5 - pin it against a
  # stray value in the invoking shell.
  OPERATOR_WATCH_NOTIFY_CMD="$NOTIFY" \
  OPERATOR_WATCH_START_CMD="true" \
  OPERATOR_WATCH_MAX_ATTEMPTS=5 \
    bb "$SUPERVISOR_BB" "$ROOT" --check-once

  ANNOUNCE_COUNT=0
  TEXT=""
  if [[ -f "$CAP" ]]; then
    ANNOUNCE_COUNT="$(wc -l < "$CAP" | tr -d ' ')"
    TEXT="$(head -n 1 "$CAP")"
  fi
  if [[ "$ANNOUNCE_COUNT" -gt 0 ]]; then ANNOUNCED=true; else ANNOUNCED=false; fi

  # The drive must have produced the event it was aimed at, or the
  # announced-ness assertion is about the wrong thing entirely.
  if [[ -n "$intended_tag" ]]; then
    if ! grep -qE " ${intended_tag}( |\$)" "$DRIVE_LOG"; then
      echo "EVENT_OBSERVED=none"
      echo "FAIL: mode '$mode' never produced event '$intended_tag'; log:" >&2
      cat "$DRIVE_LOG" >&2 || true
      return 1
    fi
    echo "EVENT_OBSERVED=$intended_tag"
  else
    if grep -qE ' (started|crashed|healthy-reset|gave-up|re-armed|deliberately-stopped)( |$)' "$DRIVE_LOG" 2>/dev/null; then
      echo "EVENT_OBSERVED=unexpected"
      echo "FAIL: mode '$mode' was aimed at the nil event but the log shows one; log:" >&2
      cat "$DRIVE_LOG" >&2 || true
      return 1
    fi
    echo "EVENT_OBSERVED=none"
  fi
  echo "ANNOUNCE_COUNT=$ANNOUNCE_COUNT"
  echo "ANNOUNCED=$ANNOUNCED"
  echo "TEXT=$TEXT"
}

predicate_says() {
  # true/false from the REAL announced-event?, never a list kept here.
  bb -e "(load-file \"$WATCH_LIB\") (print (operator-runtime-watch-lib/announced-event? $1))"
}

if [[ "${1:-}" == "--all" ]]; then
  fails=0
  # mode -> the keyword announced-event? is asked about (nil for healthy).
  for pair in \
    "started-no-pidfile :started" \
    "crashed :crashed" \
    "healthy-reset :healthy-reset" \
    "gave-up :gave-up" \
    "re-armed :re-armed" \
    "healthy nil"; do
    mode="${pair%% *}"
    kw="${pair##* }"
    if ! drive_event "$mode"; then
      echo "FAIL: $mode drive failed"
      fails=$((fails + 1))
      continue
    fi
    expected="$(predicate_says "$kw")"
    if [[ "$ANNOUNCED" != "$expected" ]]; then
      echo "FAIL: event $kw - announced-event? says $expected but the real supervisor announced=$ANNOUNCED (count=$ANNOUNCE_COUNT, text='$TEXT')"
      fails=$((fails + 1))
    else
      echo "OK: event $kw announced=$ANNOUNCED matches announced-event?"
    fi
  done
  if [[ "$fails" -gt 0 ]]; then
    echo "FAIL: $fails event(s) disagree between the real announce path and announced-event?"
    exit 1
  fi
  echo "PASS: all 6 reachable events announce exactly per announced-event?"
else
  drive_event "${1:?usage: bl993_announce_matches_predicate.sh --all | <mode>}"
fi
