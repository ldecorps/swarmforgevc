#!/usr/bin/env bash
# Smoke test for the onboarding negotiation relay supervisor
# (negotiation_relay_supervisor.bb, BL-381 QA bounce). Mirrors
# test_front_desk_supervisor_tick.sh's own shape (real child processes, real
# liveness checks, a fake compiled entrypoint instead of live Telegram
# credentials) but for this supervisor's single :relay process-spec instead
# of front-desk's :bridge/:bot pair.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/swarm/extension/out/tools" "$d/target/.swarmforge/operator"
  cp "$SRC/negotiation_relay_supervisor.bb" "$SRC/front_desk_supervisor_lib.bb" "$SRC/operator_lib.bb" "$SRC/daemon_alarm_lib.bb" "$d/swarm/"
  write_healthy_relay_js "$d"
  printf '%s' "$d"
}

# A "healthy" fake relay must write the poll heartbeat the supervisor reads -
# without it, a process that merely stays alive reads as stalled (nil
# heartbeat counts as stale), which would falsely trip every "stays running"
# assertion below. target-repo-path is process.argv[2] (poll-loop's own
# first CLI arg).
write_healthy_relay_js() {
  cat > "$1/swarm/extension/out/tools/relay-onboarding-negotiation-telegram.js" <<'EOF'
const fs = require('fs');
const path = require('path');
const root = process.argv[2] || '.';
const hbPath = path.join(root, '.swarmforge', 'operator', 'negotiation-relay-poll-heartbeat.json');
function beat() {
  fs.mkdirSync(path.dirname(hbPath), { recursive: true });
  fs.writeFileSync(hbPath, JSON.stringify({ lastHeartbeatMs: Date.now() }));
}
beat();
setInterval(beat, 200);
EOF
}

STATUS() { echo "$1/target/.swarmforge/operator/negotiation-relay-supervisor.status.json"; }

check_once() {
  TELEGRAM_PRINCIPAL_USER_ID=1 \
    NEGOTIATION_RELAY_MAX_ATTEMPTS="${NEGOTIATION_RELAY_MAX_ATTEMPTS:-3}" \
    NEGOTIATION_RELAY_BACKOFF_BASE_MS="${NEGOTIATION_RELAY_BACKOFF_BASE_MS:-10}" \
    NEGOTIATION_RELAY_BACKOFF_MAX_MS="${NEGOTIATION_RELAY_BACKOFF_MAX_MS:-40}" \
    bb "$1/swarm/negotiation_relay_supervisor.bb" "$1/swarm" "$1/target" "$1/target/secrets.json" --check-once
}
jget() { bb -e "(require '[cheshire.core :as j]) (println (get-in (j/parse-string (slurp \"$1\") true) $2))"; }
cleanup_children() {
  pkill -f "$1/swarm/extension/out/tools/relay-onboarding-negotiation-telegram.js" 2>/dev/null || true
}

# ── 1. first check-once: the relay is started, attempt 1, running ───────────
F="$(make_fixture)"
check_once "$F" > /dev/null
check "first check-once starts the relay (attempt 1, running)" \
  '[[ "$(jget "$(STATUS "$F")" "[:relay :status]")" == running ]]'
check "status.json records attempt 1" \
  '[[ "$(jget "$(STATUS "$F")" "[:relay :attempts]")" -eq 1 ]]'

# ── 2. a second check-once (nothing crashed) leaves it alone at attempt 1 ───
check_once "$F" > /dev/null
check "a healthy process is never restarted (still attempt 1)" \
  '[[ "$(jget "$(STATUS "$F")" "[:relay :attempts]")" -eq 1 ]]'
cleanup_children "$F"
rm -rf "$F"

# ── 3. a crashed process is detected, waits out its backoff, then restarts
#      (bounded) - and after the configured cap, gives up ──────────────────
F="$(make_fixture)"
cat > "$F/swarm/extension/out/tools/relay-onboarding-negotiation-telegram.js" <<'EOF'
process.exit(1);
EOF
export NEGOTIATION_RELAY_MAX_ATTEMPTS=2 NEGOTIATION_RELAY_BACKOFF_BASE_MS=10 NEGOTIATION_RELAY_BACKOFF_MAX_MS=20
check_once "$F" > /dev/null
check "attempt 1 starts (briefly) before crashing" \
  '[[ "$(jget "$(STATUS "$F")" "[:relay :attempts]")" -eq 1 ]]'
sleep 0.2
check_once "$F" > /dev/null
check "a crashed process is detected and moved to waiting-or-restarted" \
  '[[ "$(jget "$(STATUS "$F")" "[:relay :status]")" != running ]] || [[ "$(jget "$(STATUS "$F")" "[:relay :attempts]")" -gt 1 ]]'
gave_up=0
for _ in $(seq 1 15); do
  sleep 0.2
  check_once "$F" > /dev/null
  if [[ "$(jget "$(STATUS "$F")" "[:relay :status]")" == gave-up ]]; then
    gave_up=1
    break
  fi
done
check "after the bounded cap (max-attempts=2), the relay gives up rather than restarting forever" \
  '[[ "$gave_up" -eq 1 ]]'
check "the relay never exceeds the configured attempt cap" \
  '[[ "$(jget "$(STATUS "$F")" "[:relay :attempts]")" -eq 2 ]]'
unset NEGOTIATION_RELAY_MAX_ATTEMPTS NEGOTIATION_RELAY_BACKOFF_BASE_MS NEGOTIATION_RELAY_BACKOFF_MAX_MS
cleanup_children "$F"
rm -rf "$F"

# ── 4. a stalled (live pid, stale heartbeat) relay gets the same bounded
#      restart a crash gets - a live pid is not proof it is still polling ───
F="$(make_fixture)"
cat > "$F/swarm/extension/out/tools/relay-onboarding-negotiation-telegram.js" <<'EOF'
setInterval(() => {}, 1000);
EOF
export NEGOTIATION_RELAY_MAX_ATTEMPTS=3 NEGOTIATION_RELAY_BACKOFF_BASE_MS=10 NEGOTIATION_RELAY_BACKOFF_MAX_MS=20 NEGOTIATION_RELAY_STALL_MS=100
check_once "$F" > /dev/null
check "setup: the relay starts running with no heartbeat yet" \
  '[[ "$(jget "$(STATUS "$F")" "[:relay :status]")" == running ]]'
OLD_PID="$(jget "$(STATUS "$F")" "[:relay :pid]")"
check "setup: the old relay pid is alive right after it starts" \
  'kill -0 "$OLD_PID" 2>/dev/null'
sleep 0.3
check_once "$F" > /dev/null
check "a live pid with a stale/missing heartbeat is reported as stalled, not left running" \
  '[[ "$(jget "$(STATUS "$F")" "[:relay :status]")" == stalled ]] || [[ "$(jget "$(STATUS "$F")" "[:relay :attempts]")" -gt 1 ]]'
# BL-411: let the (10ms) backoff window elapse, then let the supervisor act
# on the restart decision - this is the tick that must terminate OLD_PID
# (SIGTERM -> bounded grace -> SIGKILL) before spawning the replacement. A
# revert of the kill-pid! wiring (back to check-one!'s pre-fix 7-arg call)
# would leave OLD_PID an orphaned, still-alive second poller here - exactly
# the two-getUpdates-pollers-on-one-token exposure this ticket closes.
sleep 0.2
check_once "$F" > /dev/null
NEW_PID="$(jget "$(STATUS "$F")" "[:relay :pid]")"
check "BL-411: the restart spawns a genuinely different relay pid" \
  '[[ "$NEW_PID" != "$OLD_PID" ]]'
check "BL-411: the prior relay pid is confirmed dead, not left as an orphaned second poller" \
  '! kill -0 "$OLD_PID" 2>/dev/null'
check "BL-411: the replacement relay pid is alive" \
  'kill -0 "$NEW_PID" 2>/dev/null'
unset NEGOTIATION_RELAY_MAX_ATTEMPTS NEGOTIATION_RELAY_BACKOFF_BASE_MS NEGOTIATION_RELAY_BACKOFF_MAX_MS NEGOTIATION_RELAY_STALL_MS
cleanup_children "$F"
rm -rf "$F"

# ── 5. give-up escalates exactly once via the forced-result test seam ───────
F="$(make_fixture)"
cat > "$F/swarm/extension/out/tools/relay-onboarding-negotiation-telegram.js" <<'EOF'
process.exit(1);
EOF
export NEGOTIATION_RELAY_MAX_ATTEMPTS=1 NEGOTIATION_RELAY_BACKOFF_BASE_MS=10 NEGOTIATION_RELAY_BACKOFF_MAX_MS=20
export NEGOTIATION_RELAY_ESCALATION_FORCE_RESULT='{"success":true}'
check_once "$F" > /dev/null
gave_up=0
for _ in $(seq 1 15); do
  sleep 0.2
  check_once "$F" > /dev/null
  if [[ "$(jget "$(STATUS "$F")" "[:relay :status]")" == gave-up ]]; then
    gave_up=1
    break
  fi
done
check "setup: the relay reaches gave-up (max-attempts=1)" '[[ "$gave_up" -eq 1 ]]'
ESC_FILE="$F/target/.swarmforge/operator/negotiation-relay-escalation-alarm.json"
check "an escalation alarm file is written once given up" '[[ -f "$ESC_FILE" ]]'
check "the escalation is armed after a confirmed successful delivery" \
  '[[ "$(jget "$ESC_FILE" "[:relay :armed?]")" == true ]]'
unset NEGOTIATION_RELAY_MAX_ATTEMPTS NEGOTIATION_RELAY_BACKOFF_BASE_MS NEGOTIATION_RELAY_BACKOFF_MAX_MS NEGOTIATION_RELAY_ESCALATION_FORCE_RESULT
cleanup_children "$F"
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "negotiation_relay_supervisor smoke: ALL CHECKS PASSED"
else
  echo "negotiation_relay_supervisor smoke: FAILURES"; exit 1
fi
