#!/usr/bin/env bash
# BL-436: proves front_desk_supervisor.bb's REAL wiring resolves Telegram
# creds/bridge-port from a per-swarm fleet creds file, not just the pure
# resolver (already covered by fleet_telegram_creds_lib_test_runner.bb).
# The fake bot entrypoint dumps the env/argv it actually received to a
# file, so this asserts on what a real spawned child process actually saw
# - not merely that the supervisor process stayed alive. SWARMFORGE_FLEET_HOME
# always points at an isolated fixture root, never the real $HOME (which is
# genuinely populated on this host - see fleet_telegram_creds_lib.bb).
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
  cp "$SRC/front_desk_supervisor.bb" "$SRC/front_desk_supervisor_lib.bb" "$SRC/operator_lib.bb" "$SRC/daemon_alarm_lib.bb" \
     "$SRC/swarm_identity_lib.bb" "$SRC/fleet_telegram_creds_lib.bb" "$d/"
  cat > "$d/extension/out/tools/start-bridge-headless.js" <<'EOF'
setInterval(() => {}, 1000);
EOF
  # Dumps the env vars and argv this fake bot actually received, then stays
  # alive - so a --check-once run leaves durable evidence of real wiring.
  cat > "$d/extension/out/tools/telegram-front-desk-bot.js" <<'EOF'
const fs = require('fs');
const path = require('path');
fs.writeFileSync(path.join(__dirname, '..', '..', '..', '.swarmforge', 'operator', 'received-env.json'), JSON.stringify({
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || null,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || null,
  bridgeUrlArg: process.argv[2] || null,
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

received_env() { cat "$1/.swarmforge/operator/received-env.json"; }

# ── per-swarm-telegram-creds-01/03: a non-primary swarm resolves from its
#    fleet creds file, ignoring an inherited primary token in the env ─────
D1="$(make_fixture)"
FLEET_HOME_1="$(mktemp -d)"; register_tmp_dir "$FLEET_HOME_1"
write_swarm_identity "$D1" "fes"
write_fleet_creds "$FLEET_HOME_1" "fes" "fes-real-token" "fes-real-chat" 9001

BRIDGE_TOKEN=fake-token TELEGRAM_BOT_TOKEN=primary-token-leaked-into-shell TELEGRAM_CHAT_ID=primary-chat-leaked-into-shell \
  TELEGRAM_PRINCIPAL_USER_ID=1 SWARMFORGE_FLEET_HOME="$FLEET_HOME_1" \
  bb "$D1/front_desk_supervisor.bb" "$D1" --check-once >/dev/null 2>&1 || true
sleep 0.3

ENV1="$(received_env "$D1")"
check "01: the fes bot receives its OWN fleet creds token, not the shell's" \
  "echo '$ENV1' | grep -q 'fes-real-token'"
check "01: the fes bot receives its OWN fleet creds chat id" \
  "echo '$ENV1' | grep -q 'fes-real-chat'"
check "03: the fes bot does NOT receive the primary token leaked into the shell" \
  "! echo '$ENV1' | grep -q 'primary-token-leaked-into-shell'"

# ── per-swarm-telegram-creds-04: bridge port comes from the creds file ───
check "04: the bot's bridge URL argv reflects the fleet creds file's bridgePort (9001)" \
  "echo '$ENV1' | grep -q ':9001'"

# ── per-swarm-telegram-creds-02: the primary swarm with no creds file
#    falls back to the environment ────────────────────────────────────────
D2="$(make_fixture)"
FLEET_HOME_2="$(mktemp -d)"; register_tmp_dir "$FLEET_HOME_2"
write_swarm_identity "$D2" "primary"
# Deliberately no fleet creds file written for "primary" under FLEET_HOME_2.

BRIDGE_TOKEN=fake-token TELEGRAM_BOT_TOKEN=env-primary-token TELEGRAM_CHAT_ID=env-primary-chat \
  TELEGRAM_PRINCIPAL_USER_ID=1 SWARMFORGE_FLEET_HOME="$FLEET_HOME_2" \
  bb "$D2/front_desk_supervisor.bb" "$D2" --check-once >/dev/null 2>&1 || true
sleep 0.3

ENV2="$(received_env "$D2")"
check "02: the primary swarm with no creds file falls back to the env token" \
  "echo '$ENV2' | grep -q 'env-primary-token'"
check "02: the primary swarm with no creds file falls back to the env chat id" \
  "echo '$ENV2' | grep -q 'env-primary-chat'"

if [[ "$fail" -eq 0 ]]; then
  echo "front_desk_supervisor fleet creds wiring (BL-436): ALL CHECKS PASSED"
else
  echo "front_desk_supervisor fleet creds wiring (BL-436): FAILURES"; exit 1
fi
