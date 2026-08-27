#!/usr/bin/env bash
# BL-622: proves front_desk_supervisor.bb's REAL wiring REFUSES to launch
# (never spawns the bridge/bot, never claims its pid file) when this swarm
# is neither the recorded primary root nor holds its own fleet creds file,
# and when its resolved token collides with another fleet swarm's - the
# gap BL-436 left open (env fallback was unconditional for "primary", so a
# copied .swarmforge/ dir with an inherited shell silently became a second
# poller on the primary's token; human-confirmed incident 2026-07-24).
# SWARMFORGE_FLEET_HOME always points at an isolated fixture root, never the
# real $HOME.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge/operator" "$d/extension/out/tools"
  cp "$SRC/front_desk_supervisor.bb" "$SRC/front_desk_supervisor_lib.bb" "$SRC/process_table_lib.bb" "$SRC/operator_lib.bb" "$SRC/daemon_alarm_lib.bb" \
     "$SRC/swarm_identity_lib.bb" "$SRC/fleet_telegram_creds_lib.bb" "$d/"
  cat > "$d/extension/out/tools/start-bridge-headless.js" <<'EOF'
setInterval(() => {}, 1000);
EOF
  cat > "$d/extension/out/tools/telegram-front-desk-bot.js" <<'EOF'
const fs = require('fs');
const path = require('path');
fs.writeFileSync(path.join(__dirname, '..', '..', '..', '.swarmforge', 'operator', 'received-env.json'), JSON.stringify({
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || null,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || null,
}));
fs.writeFileSync(path.join(__dirname, '..', '..', '..', '.swarmforge', 'operator', 'front-desk-poll-heartbeat.json'), JSON.stringify({ lastHeartbeatMs: Date.now() }));
setInterval(() => {}, 1000);
EOF
  printf '%s' "$d"
}

write_swarm_identity() {
  local d="$1" swarm_name="$2"
  printf 'swarm_name\t%s\nswarm_mode\tautonomous\nswarm_mode_primary\ttrue\n' "$swarm_name" > "$d/.swarmforge/swarm-identity"
}

write_fleet_creds() {
  local fleet_home="$1" swarm_name="$2" token="$3" chat_id="$4" bridge_port="$5"
  mkdir -p "$fleet_home/.swarmforge/fleet/$swarm_name"
  printf '{"botToken":"%s","chatId":"%s","bridgePort":%s}' "$token" "$chat_id" "$bridge_port" \
    > "$fleet_home/.swarmforge/fleet/$swarm_name/telegram.json"
}

pid_file() { printf '%s' "$1/.swarmforge/operator/front-desk-supervisor.pid"; }
log_file() { printf '%s' "$1/.swarmforge/operator/front-desk-supervisor.log"; }

# ── BL-622 non-primary-never-inherits-env-token-01 ────────────────────────
# A non-primary swarm, no fleet creds file, ambient env carries the
# primary's token, and no primary root is recorded at all: refused.
D1="$(make_fixture)"
FLEET_HOME_1="$(mktemp -d)"; register_tmp_dir "$FLEET_HOME_1"
write_swarm_identity "$D1" "secondary"
# Deliberately: no primary/root record, no secondary creds file, under FLEET_HOME_1.

set +e
BRIDGE_TOKEN=fake-token TELEGRAM_BOT_TOKEN=primary-token-leaked-into-shell TELEGRAM_CHAT_ID=primary-chat-leaked-into-shell \
  TELEGRAM_PRINCIPAL_USER_ID=1 SWARMFORGE_FLEET_HOME="$FLEET_HOME_1" \
  bb "$D1/front_desk_supervisor.bb" "$D1" --check-once >/dev/null 2>&1
rc=$?
set -e

check "01: refused run exits non-zero" "[[ $rc -ne 0 ]]"
check "01: no pid file is ever claimed (front desk does not launch)" "[[ ! -f \"$(pid_file "$D1")\" ]]"
check "01: no bot process ever ran (no received-env.json)" "[[ ! -f \"$D1/.swarmforge/operator/received-env.json\" ]]"
check "01: one loud line names the swarm and explains the refusal" \
  "grep -q 'secondary' \"$(log_file "$D1")\" && grep -qi 'own' \"$(log_file "$D1")\""

# ── BL-622 primary-env-fallback-preserved-02 (with an explicit record) ────
# The recorded primary root still resolves ambient env credentials, even
# with a DIFFERENT swarm's stale creds file sitting in the same fleet home.
D2="$(make_fixture)"
FLEET_HOME_2="$(mktemp -d)"; register_tmp_dir "$FLEET_HOME_2"
write_swarm_identity "$D2" "primary"
mkdir -p "$FLEET_HOME_2/.swarmforge/fleet/primary"
printf '%s' "$D2" > "$FLEET_HOME_2/.swarmforge/fleet/primary/root"

BRIDGE_TOKEN=fake-token TELEGRAM_BOT_TOKEN=recorded-primary-token TELEGRAM_CHAT_ID=recorded-primary-chat \
  TELEGRAM_PRINCIPAL_USER_ID=1 SWARMFORGE_FLEET_HOME="$FLEET_HOME_2" \
  bb "$D2/front_desk_supervisor.bb" "$D2" --check-once >/dev/null 2>&1 || true
# Poll rather than a fixed sleep - the bot child process writes
# received-env.json asynchronously after the supervisor's own --check-once
# exits, and a flat sleep is racy under host load (same pattern
# launch_front_desk.sh's own pid-claim wait loop already uses).
for (( attempt = 1; attempt <= 30; attempt++ )); do
  [[ -f "$D2/.swarmforge/operator/received-env.json" ]] && break
  sleep 0.1
done

check "02: the recorded primary root still resolves the ambient token" \
  "grep -q 'recorded-primary-token' \"$D2/.swarmforge/operator/received-env.json\""

# ── BL-622 duplicate-token-refused-05 ──────────────────────────────────────
# fes2 resolves a token that is byte-identical to fes's own recorded token.
D5="$(make_fixture)"
FLEET_HOME_5="$(mktemp -d)"; register_tmp_dir "$FLEET_HOME_5"
write_swarm_identity "$D5" "fes2"
write_fleet_creds "$FLEET_HOME_5" "fes" "shared-token" "fes-chat" 9001
write_fleet_creds "$FLEET_HOME_5" "fes2" "shared-token" "fes2-chat" 9002

set +e
BRIDGE_TOKEN=fake-token TELEGRAM_PRINCIPAL_USER_ID=1 SWARMFORGE_FLEET_HOME="$FLEET_HOME_5" \
  bb "$D5/front_desk_supervisor.bb" "$D5" --check-once >/dev/null 2>&1
rc5=$?
set -e

check "05: a duplicate-token launch is refused (non-zero exit)" "[[ $rc5 -ne 0 ]]"
check "05: no pid file is ever claimed" "[[ ! -f \"$(pid_file "$D5")\" ]]"
check "05: one loud line names the conflicting swarm 'fes' (not just 'fes2')" \
  "grep -q \"fleet swarm 'fes'\" \"$(log_file "$D5")\""

if [[ "$fail" -eq 0 ]]; then
  echo "front_desk_supervisor BL-622 refusal wiring: ALL CHECKS PASSED"
else
  echo "front_desk_supervisor BL-622 refusal wiring: FAILURES"; exit 1
fi
