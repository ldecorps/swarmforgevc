#!/usr/bin/env bash
# BL-370: "the front desk reports itself healthy while it has stopped
# listening" - proves the STALL half (a live pid whose poll heartbeat has
# gone stale is detected, restarted, bounded, and escalated) against a
# REAL front_desk_supervisor.bb subprocess (--check-once), a real fake bot
# process, and a REAL poll-heartbeat JSON file - never a hand-rolled
# substitute for the supervisor's own read/decide/act path. Mirrors
# test_front_desk_supervisor_tick.sh's own fixture conventions.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.swarmforge/operator" "$d/extension/out/tools"
  cp "$SRC/front_desk_supervisor.bb" "$SRC/front_desk_supervisor_lib.bb" "$SRC/operator_lib.bb" "$SRC/daemon_alarm_lib.bb" "$d/"
  cat > "$d/extension/out/tools/start-bridge-headless.js" <<'EOF'
setInterval(() => {}, 1000);
EOF
  # Stays alive but NEVER writes a poll heartbeat - the exact failure mode
  # the 2026-07-13 outage was: a live pid that has stopped listening.
  cat > "$d/extension/out/tools/telegram-front-desk-bot.js" <<'EOF'
setInterval(() => {}, 1000);
EOF
  printf '%s' "$d"
}

write_heartbeat() {
  local root="$1" age_ms="$2"
  local now; now="$(bb -e '(println (System/currentTimeMillis))')"
  mkdir -p "$root/.swarmforge/operator"
  bb -e "(require '[cheshire.core :as j]) (spit \"$root/.swarmforge/operator/front-desk-poll-heartbeat.json\" (j/generate-string {:lastHeartbeatMs (- $now $age_ms)}))"
}

check_once() {
  BRIDGE_TOKEN=fake-token TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=y TELEGRAM_PRINCIPAL_USER_ID=1 \
    FRONT_DESK_MAX_ATTEMPTS="${FRONT_DESK_MAX_ATTEMPTS:-3}" \
    FRONT_DESK_BACKOFF_BASE_MS="${FRONT_DESK_BACKOFF_BASE_MS:-10}" \
    FRONT_DESK_BACKOFF_MAX_MS="${FRONT_DESK_BACKOFF_MAX_MS:-40}" \
    FRONT_DESK_STALL_MS="${FRONT_DESK_STALL_MS:-1000}" \
    bb "$1/front_desk_supervisor.bb" "$1" --check-once
}
jget() { bb -e "(require '[cheshire.core :as j]) (println (get-in (j/parse-string (slurp \"$1\") true) $2))"; }
cleanup_children() {
  pkill -f "$1/extension/out/tools/start-bridge-headless.js" 2>/dev/null || true
  pkill -f "$1/extension/out/tools/telegram-front-desk-bot.js" 2>/dev/null || true
}

# ── front-desk-liveness-01/02: a live pid is not proof it is listening ──────
F="$(make_fixture)"
check_once "$F" > /dev/null
check "setup: the bot starts running" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == running ]]'

# A fresh heartbeat, well inside the (tiny, test-only) stall window - must
# stay healthy even though nothing has "arrived" (the false-positive guard).
write_heartbeat "$F" 10
check_once "$F" > /dev/null
check "front-desk-liveness-02: a quiet-but-polling front desk is reported healthy, never stalled" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == running ]]'

# A stale heartbeat (older than FRONT_DESK_STALL_MS=1000) on a still-alive
# pid - the ~9h-outage failure mode itself.
write_heartbeat "$F" 5000
check_once "$F" > /dev/null
check "front-desk-liveness-01: a stopped-listening bot is reported as stalled, never plain 'running'" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == stalled ]]'
check "the still-alive bridge is unaffected by the bot stalling" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bridge :status]")" == running ]]'
grep -q "stalled bot" "$F/.swarmforge/operator/front-desk-supervisor.log" \
  && note "ok   - the stall is logged" || { note "FAIL - the stall is logged"; fail=1; }
cleanup_children "$F"
rm -rf "$F"

# ── front-desk-liveness-03: a stalled front desk is restarted, no human ────
F="$(make_fixture)"
export FRONT_DESK_STALL_MS=1000 FRONT_DESK_MAX_ATTEMPTS=5 FRONT_DESK_BACKOFF_BASE_MS=10 FRONT_DESK_BACKOFF_MAX_MS=40
check_once "$F" > /dev/null
write_heartbeat "$F" 5000
check_once "$F" > /dev/null
check "the bot transitions to stalled" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == stalled ]]'
sleep 0.2
check_once "$F" > /dev/null
check "front-desk-liveness-03: a stalled front desk is restarted with no human action (attempts grows, running again)" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == running ]] && [[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :attempts]")" -gt 1 ]]'
check "front-desk-liveness-03: it resumes listening (a fresh pid is spawned)" \
  '[[ -n "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :pid]")" ]]'
unset FRONT_DESK_STALL_MS FRONT_DESK_MAX_ATTEMPTS FRONT_DESK_BACKOFF_BASE_MS FRONT_DESK_BACKOFF_MAX_MS
cleanup_children "$F"
rm -rf "$F"

# ── front-desk-liveness-04: bounded restarts, giving up is loud ────────────
F="$(make_fixture)"
export FRONT_DESK_STALL_MS=1000 FRONT_DESK_MAX_ATTEMPTS=1 FRONT_DESK_BACKOFF_BASE_MS=10 FRONT_DESK_BACKOFF_MAX_MS=20
check_once "$F" > /dev/null
gave_up=0
for _ in $(seq 1 15); do
  write_heartbeat "$F" 5000
  check_once "$F" > /dev/null
  sleep 0.2
  if [[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == gave-up ]]; then
    gave_up=1
    break
  fi
done
check "front-desk-liveness-04: repeated stalls stop restarting at the cap (gives up)" \
  '[[ "$gave_up" -eq 1 ]]'
check "front-desk-liveness-04: the failure is escalated to the human (logged loudly)" \
  'grep -q "escalation bot" "$F/.swarmforge/operator/front-desk-supervisor.log"'
unset FRONT_DESK_STALL_MS FRONT_DESK_MAX_ATTEMPTS FRONT_DESK_BACKOFF_BASE_MS FRONT_DESK_BACKOFF_MAX_MS
cleanup_children "$F"
rm -rf "$F"

# ── front-desk-liveness-05: the escalation is retried, never silenced on a
#    failed send (BL-345's own delivery-based arming, reused wholesale) ────
F="$(make_fixture)"
export FRONT_DESK_STALL_MS=1000 FRONT_DESK_MAX_ATTEMPTS=1 FRONT_DESK_BACKOFF_BASE_MS=10 FRONT_DESK_BACKOFF_MAX_MS=20 \
       FRONT_DESK_ESCALATION_BACKOFF_BASE_MS=1 FRONT_DESK_ESCALATION_BACKOFF_MAX_MS=1 \
       FRONT_DESK_ESCALATION_FORCE_RESULT='{"success":false}'
check_once "$F" > /dev/null
gave_up=0
for _ in $(seq 1 15); do
  write_heartbeat "$F" 5000
  check_once "$F" > /dev/null
  sleep 0.2
  if [[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == gave-up ]]; then
    gave_up=1
    break
  fi
done
check "front-desk-liveness-05 setup: the bot gives up" '[[ "$gave_up" -eq 1 ]]'
attempts_1="$(jget "$F/.swarmforge/operator/front-desk-escalation-alarm.json" "[:bot :delivery-attempts]")"
check "front-desk-liveness-05: a failed escalation send is NOT armed (never silenced on a mere attempt)" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-escalation-alarm.json" "[:bot :armed?]")" == false ]]'
sleep 0.1
check_once "$F" > /dev/null
attempts_2="$(jget "$F/.swarmforge/operator/front-desk-escalation-alarm.json" "[:bot :delivery-attempts]")"
check "front-desk-liveness-05: the supervisor attempts the escalation again on the next check" \
  '[[ "$attempts_2" -gt "$attempts_1" ]]'
unset FRONT_DESK_STALL_MS FRONT_DESK_MAX_ATTEMPTS FRONT_DESK_BACKOFF_BASE_MS FRONT_DESK_BACKOFF_MAX_MS \
      FRONT_DESK_ESCALATION_BACKOFF_BASE_MS FRONT_DESK_ESCALATION_BACKOFF_MAX_MS FRONT_DESK_ESCALATION_FORCE_RESULT
cleanup_children "$F"
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "front_desk_supervisor liveness (BL-370): ALL CHECKS PASSED"
else
  echo "front_desk_supervisor liveness (BL-370): FAILURES"; exit 1
fi
