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
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/bb_closure_copy.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/bb_fixture_load_guard.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge/operator" "$d/extension/out/tools"
  # BL-1279: the copy set is DERIVED from front_desk_supervisor.bb's transitive
  # load-file closure, never hand-listed. The hand list this replaces named six
  # of eight libs and every bb subprocess here died at load, with five of the
  # eight checks in the refusal test still reporting OK - a crash satisfies a
  # negative assertion by accident. The two missing edges arrived in commits
  # that restored dropped work (20999b11c, 8feaa2ad2) and nothing made them
  # update four cp lines; BL-973 built the derivation for exactly this rot.
  copy_bb_closure "$SRC" "$d" front_desk_supervisor.bb \
    || { printf 'FAIL - %s\n' "could not derive front_desk_supervisor.bb's load-file closure" >&2; exit 1; }
  # And nothing runs until that root can actually load (BL-1279 invariant 2).
  assert_bb_closure_present "$SRC" "$d" front_desk_supervisor.bb
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
  "echo '$ENV1' | grep 'fes-real-token' >/dev/null"
check "01: the fes bot receives its OWN fleet creds chat id" \
  "echo '$ENV1' | grep 'fes-real-chat' >/dev/null"
check "03: the fes bot does NOT receive the primary token leaked into the shell" \
  "! echo '$ENV1' | grep 'primary-token-leaked-into-shell' >/dev/null"

# ── per-swarm-telegram-creds-04: bridge port comes from the creds file ───
check "04: the bot's bridge URL argv reflects the fleet creds file's bridgePort (9001)" \
  "echo '$ENV1' | grep ':9001' >/dev/null"

# ── per-swarm-telegram-creds-02: the primary swarm with no creds file
#    falls back to the environment ────────────────────────────────────────
D2="$(make_fixture)"
FLEET_HOME_2="$(mktemp -d)"; register_tmp_dir "$FLEET_HOME_2"
write_swarm_identity "$D2" "primary"
# Deliberately no fleet creds file written for "primary" under FLEET_HOME_2.

# BL-1779 QA bounce D1: with no creds file (unlike case 01's own 9001),
# decide-bridge-port-action's default falls through to BRIDGE_PORT's own
# default of 8765 - the LIVE front desk's own listening port. A free high
# port here, never 8765, keeps this fixture off the live bridge.
BRIDGE_TOKEN=fake-token TELEGRAM_BOT_TOKEN=env-primary-token TELEGRAM_CHAT_ID=env-primary-chat \
  TELEGRAM_PRINCIPAL_USER_ID=1 SWARMFORGE_FLEET_HOME="$FLEET_HOME_2" \
  BRIDGE_PORT=$((20000 + ($$ % 10000))) \
  bb "$D2/front_desk_supervisor.bb" "$D2" --check-once >/dev/null 2>&1 || true
sleep 0.3

ENV2="$(received_env "$D2")"
check "02: the primary swarm with no creds file falls back to the env token" \
  "echo '$ENV2' | grep 'env-primary-token' >/dev/null"
check "02: the primary swarm with no creds file falls back to the env chat id" \
  "echo '$ENV2' | grep 'env-primary-chat' >/dev/null"

# ── BL-1779: a fixture root that declares NO swarm identity at all never
#    reads the fleet home's "primary" creds file - even though own-swarm-
#    name defaults an undeclared root's NAME to "primary" for other
#    purposes, real fleet creds must never be borrowed this way (the exact
#    hazard: a fixture front desk spawns with the human's real bot token
#    and frees the live bridge's port, BL-622's incident class). D3
#    deliberately has NO write_swarm_identity call at all. ───────────────
D3="$(make_fixture)"
FLEET_HOME_3="$(mktemp -d)"; register_tmp_dir "$FLEET_HOME_3"
write_fleet_creds "$FLEET_HOME_3" "primary" "primary-real-token-should-never-be-used" "primary-real-chat" 18765

# BL-1779 QA bounce D1: an undeclared root reads no fleet creds file at all
# (resolve-telegram-creds-undeclared), so its own bridge-port default is
# also BRIDGE_PORT's 8765 fallback - the LIVE front desk's own listening
# port. A free high port here, never 8765 and distinct from case 02's
# own, keeps this fixture off the live bridge.
BRIDGE_TOKEN=fake-token TELEGRAM_BOT_TOKEN=undeclared-env-token TELEGRAM_CHAT_ID=undeclared-env-chat \
  TELEGRAM_PRINCIPAL_USER_ID=1 SWARMFORGE_FLEET_HOME="$FLEET_HOME_3" \
  BRIDGE_PORT=$((30000 + ($$ % 10000))) \
  bb "$D3/front_desk_supervisor.bb" "$D3" --check-once >/dev/null 2>&1 || true
sleep 0.3

ENV3="$(received_env "$D3")"
check "BL-1779: an undeclared root never receives the fleet home's real primary token" \
  "! echo '$ENV3' | grep 'primary-real-token-should-never-be-used' >/dev/null"
check "BL-1779: an undeclared root resolves via env fallback instead (bootstrap window, no record yet)" \
  "echo '$ENV3' | grep 'undeclared-env-token' >/dev/null"
check "BL-1779: an undeclared root's front desk never records itself as the primary root" \
  "[[ ! -f '$FLEET_HOME_3/.swarmforge/fleet/primary/root' ]]"

if [[ "$fail" -eq 0 ]]; then
  echo "front_desk_supervisor fleet creds wiring (BL-436): ALL CHECKS PASSED"
else
  echo "front_desk_supervisor fleet creds wiring (BL-436): FAILURES"; exit 1
fi
