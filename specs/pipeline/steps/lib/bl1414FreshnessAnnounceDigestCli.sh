#!/usr/bin/env bash
# BL-1414 acceptance driver: invokes the REAL daemon_log_freshness_check.sh
# (never a reimplementation) against a real fixture root, one mode per
# Gherkin scenario run. Mirrors the shell unit test's own
# run_checker_digest/seed_announce_state fixture shapes exactly (same
# file, swarmforge/scripts/test/test_daemon_log_freshness.sh) so the
# acceptance layer and the unit layer can never silently disagree about
# what a "tick" or a "seeded announce state" means.
#
# Usage: bl1414FreshnessAnnounceDigestCli.sh <mode>
#   modes: first-violation | repeat-suppressed | digest-after-window |
#          recovery-once | different-daemon-same-reason |
#          same-daemon-different-reason
# Prints one JSON line:
#   {"announceCount":N,"announces":["...","..."],"incidentCount":N,
#    "stateSuppressed":N-or-null}

set -uo pipefail
MODE="${1:?usage: bl1414FreshnessAnnounceDigestCli.sh <mode>}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
CHECKER="$REPO_ROOT/swarmforge/scripts/daemon_log_freshness_check.sh"
CONF="$REPO_ROOT/swarmforge/scripts/test/fixtures/daemon_log_freshness.fixture.conf"

ROOT="$(mktemp -d)"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

mkdir -p "$ROOT/.swarmforge/daemon" "$ROOT/.swarmforge/babysitterd"
chmod +x "$CHECKER"

ts() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; }

run_checker_digest() {
  local now=$1 digest=$2
  FRESHNESS_ROOT="$ROOT" \
  FRESHNESS_CONF="$CONF" \
  FRESHNESS_NOW_EPOCH="$now" \
  FRESHNESS_INCIDENT_FILE="$ROOT/.swarmforge/daemon/freshness-incidents.log" \
  FRESHNESS_COOL_OFF_SECS=300 \
  FRESHNESS_ANNOUNCE_DIGEST_SECS="$digest" \
  FRESHNESS_LOAD=1 FRESHNESS_CORES=1 \
  FRESHNESS_ANNOUNCE_CMD="printf '%s\n' \"\$1\" >> \"$ROOT/announces.log\"" \
  FRESHNESS_KILL_CMD="printf '%s\n' \"\$1\" >> \"$ROOT/kills.log\"" \
  FRESHNESS_START_CMD="printf '%s %s\n' \"\$1\" \"\$2\" >> \"$ROOT/starts.log\"" \
  /bin/sh "$CHECKER" >/dev/null 2>&1
}

seed_announce_state() {
  local daemon=$1 reason=$2 announced=$3 suppressed=$4 started=$5
  mkdir -p "$ROOT/.swarmforge/daemon/freshness-announce"
  printf 'announced_epoch=%s suppressed=%s violation_started_epoch=%s\n' \
    "$announced" "$suppressed" "$started" \
    > "$ROOT/.swarmforge/daemon/freshness-announce/${daemon}__${reason}.state"
}

NOW=1700000000

case "$MODE" in
  first-violation)
    printf '%s heartbeat\n' "$(ts $((NOW - 200)))" > "$ROOT/.swarmforge/daemon/handoffd.log"
    printf '%s heartbeat\n' "$(ts "$NOW")" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
    sleep 120 & FAKE_PID=$!
    echo "$FAKE_PID" > "$ROOT/.swarmforge/daemon/handoffd.pid"
    run_checker_digest "$NOW" 1800
    kill "$FAKE_PID" 2>/dev/null || true
    ;;

  repeat-suppressed)
    printf '%s heartbeat\n' "$(ts $((NOW - 200)))" > "$ROOT/.swarmforge/daemon/handoffd.log"
    printf '%s heartbeat\n' "$(ts $((NOW - 200)))" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
    printf 'epoch=%s daemon=handoffd age_secs=200 threshold=120 action=restart\n' "$((NOW - 60))" \
      > "$ROOT/.swarmforge/daemon/freshness-incidents.log"
    seed_announce_state handoffd stale-heartbeat "$((NOW - 60))" 0 "$((NOW - 60))"
    for i in 1 2 3 4 5; do
      run_checker_digest "$((NOW + i * 30))" 1800
    done
    ;;

  digest-after-window)
    printf '%s heartbeat\n' "$(ts $((NOW - 200)))" > "$ROOT/.swarmforge/daemon/handoffd.log"
    printf '%s heartbeat\n' "$(ts $((NOW - 200)))" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
    printf 'epoch=%s daemon=handoffd age_secs=200 threshold=120 action=restart\n' "$((NOW - 60))" \
      > "$ROOT/.swarmforge/daemon/freshness-incidents.log"
    seed_announce_state handoffd stale-heartbeat "$((NOW - 1860))" 14 "$((NOW - 1860))"
    run_checker_digest "$NOW" 1800
    ;;

  recovery-once)
    printf '%s heartbeat\n' "$(ts "$NOW")" > "$ROOT/.swarmforge/daemon/handoffd.log"
    printf '%s heartbeat\n' "$(ts "$NOW")" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
    seed_announce_state handoffd stale-heartbeat "$((NOW - 60))" 2 "$((NOW - 600))"
    run_checker_digest "$NOW" 1800
    run_checker_digest "$((NOW + 120))" 1800
    ;;

  different-daemon-same-reason)
    printf '%s heartbeat\n' "$(ts "$NOW")" > "$ROOT/.swarmforge/daemon/handoffd.log"
    printf '%s heartbeat\n' "$(ts $((NOW - 700)))" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
    seed_announce_state handoffd stale-heartbeat "$((NOW - 60))" 3 "$((NOW - 60))"
    run_checker_digest "$NOW" 1800
    ;;

  same-daemon-different-reason)
    : > "$ROOT/.swarmforge/daemon/handoffd.log"
    printf '%s heartbeat\n' "$(ts "$NOW")" > "$ROOT/.swarmforge/babysitterd/babysitterd.log"
    seed_announce_state handoffd stale-heartbeat "$((NOW - 60))" 3 "$((NOW - 60))"
    run_checker_digest "$NOW" 1800
    ;;

  *)
    echo "unknown mode: $MODE" >&2
    exit 2
    ;;
esac

ANNOUNCE_COUNT=0
ANNOUNCES_JSON="[]"
if [[ -f "$ROOT/announces.log" ]]; then
  ANNOUNCE_COUNT="$(wc -l < "$ROOT/announces.log" | tr -d ' ')"
  ANNOUNCES_JSON="$(node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
    process.stdout.write(JSON.stringify(lines));
  ' "$ROOT/announces.log")"
fi

INCIDENT_COUNT=0
if [[ -f "$ROOT/.swarmforge/daemon/freshness-incidents.log" ]]; then
  INCIDENT_COUNT="$(wc -l < "$ROOT/.swarmforge/daemon/freshness-incidents.log" | tr -d ' ')"
fi

STATE_SUPPRESSED="null"
STATE_FILE="$ROOT/.swarmforge/daemon/freshness-announce/handoffd__stale-heartbeat.state"
if [[ -f "$STATE_FILE" ]]; then
  STATE_SUPPRESSED="$(sed -n 's/.*suppressed=\([0-9][0-9]*\).*/\1/p' "$STATE_FILE" | head -n 1)"
  [[ -n "$STATE_SUPPRESSED" ]] || STATE_SUPPRESSED="null"
fi

printf '{"announceCount":%s,"announces":%s,"incidentCount":%s,"stateSuppressed":%s}\n' \
  "$ANNOUNCE_COUNT" "$ANNOUNCES_JSON" "$INCIDENT_COUNT" "$STATE_SUPPRESSED"
