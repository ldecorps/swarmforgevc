#!/usr/bin/env bash
# BL-1151: give-up escalation emails once per unbroken outage episode.

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "PASS: $1"; else note "FAIL: $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge/operator" "$d/extension/out/tools"
  cp "$SRC/front_desk_supervisor.bb" "$SRC/front_desk_supervisor_lib.bb" "$SRC/process_table_lib.bb" "$SRC/operator_lib.bb" "$SRC/daemon_alarm_lib.bb" \
     "$SRC/swarm_identity_lib.bb" "$SRC/fleet_telegram_creds_lib.bb" "$d/"
  cat > "$d/extension/out/tools/start-bridge-headless.js" <<'EOF'
setInterval(() => {}, 1000);
EOF
  write_healthy_bot_js "$d"
  printf '%s' "$d"
}

write_healthy_bot_js() {
  cat > "$1/extension/out/tools/telegram-front-desk-bot.js" <<'EOF'
const fs = require('fs');
const path = require('path');
const root = process.argv[3] || '.';
const hbPath = path.join(root, '.swarmforge', 'operator', 'front-desk-poll-heartbeat.json');
function beat() {
  fs.mkdirSync(path.dirname(hbPath), { recursive: true });
  fs.writeFileSync(hbPath, JSON.stringify({ lastHeartbeatMs: Date.now() }));
}
beat();
setInterval(beat, 200);
EOF
}

write_crash_bot_js() {
  cat > "$1/extension/out/tools/telegram-front-desk-bot.js" <<'EOF'
process.exit(1);
EOF
}

check_once() {
  BRIDGE_TOKEN=fake-token TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=y TELEGRAM_PRINCIPAL_USER_ID=1 \
    FRONT_DESK_MAX_ATTEMPTS="${FRONT_DESK_MAX_ATTEMPTS:-3}" \
    FRONT_DESK_BACKOFF_BASE_MS="${FRONT_DESK_BACKOFF_BASE_MS:-10}" \
    FRONT_DESK_BACKOFF_MAX_MS="${FRONT_DESK_BACKOFF_MAX_MS:-40}" \
    FRONT_DESK_GIVEUP_COOLDOWN_MS="${FRONT_DESK_GIVEUP_COOLDOWN_MS:-900000}" \
    FRONT_DESK_HEALTHY_RESET_MS="${FRONT_DESK_HEALTHY_RESET_MS:-600000}" \
    FRONT_DESK_ESCALATION_FORCE_RESULT="${FRONT_DESK_ESCALATION_FORCE_RESULT:-}" \
    bb "$1/front_desk_supervisor.bb" "$1" --check-once
}

jget() { bb -e "(require '[cheshire.core :as j]) (println (get-in (j/parse-string (slurp \"$1\") true) $2))"; }

count_escalation_delivered() {
  grep -c "escalation bot delivered" "$1/.swarmforge/operator/front-desk-supervisor.log" 2>/dev/null || echo 0
}

cleanup_children() {
  pkill -f "$1/extension/out/tools/start-bridge-headless.js" 2>/dev/null || true
  pkill -f "$1/extension/out/tools/telegram-front-desk-bot.js" 2>/dev/null || true
}

drive_to_gave_up() {
  local F="$1"
  local tries="${2:-15}"
  local i
  for ((i=0; i<tries; i++)); do
    sleep 0.2
    check_once "$F" > /dev/null
    if [[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == gave-up ]]; then
      return 0
    fi
  done
  return 1
}

# Swap in a crash entrypoint and kill the live child so the supervisor
# actually respawns against the new script (mirrors tick.sh section 3).
force_bot_crash() {
  write_crash_bot_js "$1"
  pkill -f "$1/extension/out/tools/telegram-front-desk-bot.js" 2>/dev/null || true
  sleep 0.2
}

# ── Scenario 01 + 03: loop emails once ───────────────────────────────────────
F="$(make_fixture)"
write_crash_bot_js "$F"
export FRONT_DESK_MAX_ATTEMPTS=1 FRONT_DESK_BACKOFF_BASE_MS=10 FRONT_DESK_BACKOFF_MAX_MS=20 \
  FRONT_DESK_GIVEUP_COOLDOWN_MS=300 FRONT_DESK_ESCALATION_FORCE_RESULT='{"success":true}'

check_once "$F" > /dev/null
drive_to_gave_up "$F"
check "bl-1151-01 setup: bot reaches gave-up" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == gave-up ]]'
check "bl-1151-01: first give-up arms escalation after delivered email" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-escalation-alarm.json" "[:bot :armed?]")" == true ]]'
delivered_1="$(count_escalation_delivered "$F")"
check "bl-1151-01: exactly one delivered escalation so far" '[[ "$delivered_1" -eq 1 ]]'

write_healthy_bot_js "$F"
sleep 0.35
check_once "$F" > /dev/null
check "bl-1151-01: cooldown re-armed to running" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == running ]]'
check "bl-1151-03: re-arm without healthy grace keeps escalation armed" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-escalation-alarm.json" "[:bot :armed?]")" == true ]]'

force_bot_crash "$F"
drive_to_gave_up "$F" || true
check "bl-1151-01: second give-up in same episode" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == gave-up ]]'
delivered_2="$(count_escalation_delivered "$F")"
check "bl-1151-01: no second escalation email in the loop" '[[ "$delivered_2" -eq 1 ]]'
check "bl-1151-01: escalation stays armed (suppresses re-send)" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-escalation-alarm.json" "[:bot :armed?]")" == true ]]'

unset FRONT_DESK_MAX_ATTEMPTS FRONT_DESK_BACKOFF_BASE_MS FRONT_DESK_BACKOFF_MAX_MS \
  FRONT_DESK_GIVEUP_COOLDOWN_MS FRONT_DESK_ESCALATION_FORCE_RESULT
cleanup_children "$F"

# ── Scenario 02: healthy grace allows a new episode email ───────────────────
F="$(make_fixture)"
write_crash_bot_js "$F"
export FRONT_DESK_MAX_ATTEMPTS=1 FRONT_DESK_BACKOFF_BASE_MS=10 FRONT_DESK_BACKOFF_MAX_MS=20 \
  FRONT_DESK_GIVEUP_COOLDOWN_MS=300 FRONT_DESK_HEALTHY_RESET_MS=200 \
  FRONT_DESK_ESCALATION_FORCE_RESULT='{"success":true}'

check_once "$F" > /dev/null
drive_to_gave_up "$F"

write_healthy_bot_js "$F"
sleep 0.35
check_once "$F" > /dev/null
sleep 0.25
check_once "$F" > /dev/null
check "bl-1151-02: healthy grace disarms escalation for a new episode" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-escalation-alarm.json" "[:bot :armed?]")" == false ]]'

force_bot_crash "$F"
drive_to_gave_up "$F" 25 || true
delivered_3="$(count_escalation_delivered "$F")"
check "bl-1151-02: a new episode after healthy grace may email again" '[[ "$delivered_3" -ge 2 ]]'

unset FRONT_DESK_MAX_ATTEMPTS FRONT_DESK_BACKOFF_BASE_MS FRONT_DESK_BACKOFF_MAX_MS \
  FRONT_DESK_GIVEUP_COOLDOWN_MS FRONT_DESK_HEALTHY_RESET_MS FRONT_DESK_ESCALATION_FORCE_RESULT
cleanup_children "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "test_front_desk_giveup_one_email_per_episode: ALL CHECKS PASSED"
else
  echo "test_front_desk_giveup_one_email_per_episode: FAILURES"; exit 1
fi
