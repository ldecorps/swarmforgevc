#!/usr/bin/env bash
# Smoke test for the headless front-desk supervisor (front_desk_supervisor.bb).
# Runs --check-once against isolated temp fixtures with FAKE bridge/bot
# entrypoints (tiny Node scripts, no real network/Telegram/bridge) so the
# spawn/crash-detect/bounded-restart-with-backoff loop is exercised for
# real (real child processes, real liveness checks) without any live
# credential or real HTTP server.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.swarmforge/operator" "$d/extension/out/tools"
  # BL-370: front_desk_supervisor.bb now also load-files operator_lib.bb
  # (reused BL-345 delivery-based alarm arming) and daemon_alarm_lib.bb
  # (the email send path) relative to its own dir - both must ship
  # alongside it in every fixture, or the supervisor fails to even load.
  cp "$SRC/front_desk_supervisor.bb" "$SRC/front_desk_supervisor_lib.bb" "$SRC/operator_lib.bb" "$SRC/daemon_alarm_lib.bb" "$d/"
  # A fake entrypoint that stays alive forever (mirrors the real bridge/bot
  # processes, which never exit on their own while healthy).
  cat > "$d/extension/out/tools/start-bridge-headless.js" <<'EOF'
setInterval(() => {}, 1000);
EOF
  write_healthy_bot_js "$d"
  printf '%s' "$d"
}

# BL-370: a "healthy" fake bot must also write the poll heartbeat
# front_desk_supervisor.bb now reads - without it, a bot that merely stays
# alive (setInterval-forever, same as before BL-370) reads as stalled
# (nil heartbeat counts as stale, see poll-heartbeat-stale?'s own
# docstring), which would falsely trip every "the bot stays running"
# assertion below. project-root is process.argv[3] (argv[2] is the
# bridgeUrl the real bot entrypoint is also invoked with).
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

check_once() {
  BRIDGE_TOKEN=fake-token TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=y TELEGRAM_PRINCIPAL_USER_ID=1 \
    FRONT_DESK_MAX_ATTEMPTS="${FRONT_DESK_MAX_ATTEMPTS:-3}" \
    FRONT_DESK_BACKOFF_BASE_MS="${FRONT_DESK_BACKOFF_BASE_MS:-10}" \
    FRONT_DESK_BACKOFF_MAX_MS="${FRONT_DESK_BACKOFF_MAX_MS:-40}" \
    bb "$1/front_desk_supervisor.bb" "$1" --check-once
}
jget() { bb -e "(require '[cheshire.core :as j]) (println (get-in (j/parse-string (slurp \"$1\") true) $2))"; }
cleanup_children() {
  # Best-effort: kill anything this fixture's own fake entrypoints spawned,
  # so a failed/aborted run never leaks a lingering setInterval-forever
  # Node process onto the test host.
  pkill -f "$1/extension/out/tools/start-bridge-headless.js" 2>/dev/null || true
  pkill -f "$1/extension/out/tools/telegram-front-desk-bot.js" 2>/dev/null || true
}

# ── 1. first check-once: both bridge and bot are started, attempt 1 ──────────
F="$(make_fixture)"
check_once "$F" > /dev/null
check "first check-once starts the bridge (attempt 1, running)" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bridge :status]")" == running ]]'
check "first check-once starts the bot (attempt 1, running)" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == running ]]'
check "status.json records attempt 1 for the bridge" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bridge :attempts]")" -eq 1 ]]'

# ── 2. a second check-once (nothing crashed) leaves both alone at attempt 1 ──
check_once "$F" > /dev/null
check "a healthy process is never restarted (still attempt 1)" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bridge :attempts]")" -eq 1 ]]'
cleanup_children "$F"
rm -rf "$F"

# ── 3. headless-frontdesk-03: a crashed process is detected, waits out its
#      backoff, then restarts (bounded) - and after the configured cap,
#      gives up rather than restarting forever ────────────────────────────────
F="$(make_fixture)"
# A bot that crashes immediately every time it is spawned.
cat > "$F/extension/out/tools/telegram-front-desk-bot.js" <<'EOF'
process.exit(1);
EOF
export FRONT_DESK_MAX_ATTEMPTS=2 FRONT_DESK_BACKOFF_BASE_MS=10 FRONT_DESK_BACKOFF_MAX_MS=20
check_once "$F" > /dev/null
check "attempt 1 starts (briefly) before crashing" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :attempts]")" -eq 1 ]]'
sleep 0.2
check_once "$F" > /dev/null
check "a crashed process is detected and moved to waiting-or-restarted" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" != running ]] || [[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :attempts]")" -gt 1 ]]'
# Bounded poll (never an unbounded wait) until the bot either gives up or a
# generous tick budget is exhausted - each backoff window is 10-20ms, so
# ~15 ticks with a 0.2s sleep between them is comfortably enough for both
# the restart (attempt 2) and the subsequent give-up decision to land.
gave_up=0
for _ in $(seq 1 15); do
  sleep 0.2
  check_once "$F" > /dev/null
  if [[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == gave-up ]]; then
    gave_up=1
    break
  fi
done
check "after the bounded cap (max-attempts=2), the bot gives up rather than restarting forever" \
  '[[ "$gave_up" -eq 1 ]]'
check "the bot never exceeds the configured attempt cap" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :attempts]")" -eq 2 ]]'
unset FRONT_DESK_MAX_ATTEMPTS FRONT_DESK_BACKOFF_BASE_MS FRONT_DESK_BACKOFF_MAX_MS
check "the bridge (never crashed) is unaffected by the bot giving up" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bridge :status]")" == running ]]'
cleanup_children "$F"
rm -rf "$F"

# ── 4. BL-303 supervisor-recovery-01: a healthy, long-running process has
#      its attempt count reset (the cap counts CONSECUTIVE crashes, not
#      lifetime-accumulated ones) ─────────────────────────────────────────
F="$(make_fixture)"
# Crash the bot once (bumps attempts to 2 across the restart), then let it
# stay healthy long enough to cross a tiny FRONT_DESK_HEALTHY_RESET_MS.
cat > "$F/extension/out/tools/telegram-front-desk-bot.js" <<'EOF'
process.exit(1);
EOF
FRONT_DESK_MAX_ATTEMPTS=5 FRONT_DESK_BACKOFF_BASE_MS=10 FRONT_DESK_BACKOFF_MAX_MS=20 check_once "$F" > /dev/null
# tick 1: not-started -> running (attempt 1, but exits almost immediately)
sleep 0.2
FRONT_DESK_MAX_ATTEMPTS=5 FRONT_DESK_BACKOFF_BASE_MS=10 FRONT_DESK_BACKOFF_MAX_MS=20 check_once "$F" > /dev/null
# tick 2: running -> waiting (crash detected; the restart itself only
# happens once its own short backoff elapses, one tick later)
sleep 0.2
FRONT_DESK_MAX_ATTEMPTS=5 FRONT_DESK_BACKOFF_BASE_MS=10 FRONT_DESK_BACKOFF_MAX_MS=20 check_once "$F" > /dev/null
# tick 3: waiting -> running again (attempt 2)
check "bl-303 setup: the bot restarted at least once (attempts > 1) before the healthy window" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :attempts]")" -gt 1 ]]'
# Now let it stay alive - swap in a fixture that never crashes.
write_healthy_bot_js "$F"
FRONT_DESK_MAX_ATTEMPTS=5 FRONT_DESK_BACKOFF_BASE_MS=10 FRONT_DESK_BACKOFF_MAX_MS=20 check_once "$F" > /dev/null
sleep 0.3
FRONT_DESK_HEALTHY_RESET_MS=100 FRONT_DESK_MAX_ATTEMPTS=5 FRONT_DESK_BACKOFF_BASE_MS=10 FRONT_DESK_BACKOFF_MAX_MS=20 check_once "$F" > /dev/null
check "bl-303 supervisor-recovery-01: attempts reset to 0 once past the healthy-uptime window" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :attempts]")" -eq 0 ]]'
check "bl-303: status stays running through the reset" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == running ]]'
cleanup_children "$F"
rm -rf "$F"

# ── 5. BL-303 supervisor-recovery-02: a given-up child re-arms once its
#      cooldown elapses (attempts reset, restarted) - and stays down,
#      never spawning, while the cooldown has NOT yet elapsed ────────────
F="$(make_fixture)"
cat > "$F/extension/out/tools/telegram-front-desk-bot.js" <<'EOF'
process.exit(1);
EOF
export FRONT_DESK_MAX_ATTEMPTS=1 FRONT_DESK_BACKOFF_BASE_MS=10 FRONT_DESK_BACKOFF_MAX_MS=20 FRONT_DESK_GIVEUP_COOLDOWN_MS=300
check_once "$F" > /dev/null
gave_up=0
for _ in $(seq 1 15); do
  sleep 0.2
  check_once "$F" > /dev/null
  if [[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == gave-up ]]; then
    gave_up=1
    break
  fi
done
check "bl-303 setup: the bot reaches gave-up (max-attempts=1)" '[[ "$gave_up" -eq 1 ]]'

# Immediately re-check, well before the 300ms cooldown - must stay down.
check_once "$F" > /dev/null
check "bl-303 supervisor-recovery-02 [not elapsed]: still gave-up, not restarted" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == gave-up ]]'

# Swap in a healthy entrypoint (so the re-armed child does not immediately
# crash and give up again), wait past the cooldown, then re-check.
write_healthy_bot_js "$F"
sleep 0.4
check_once "$F" > /dev/null
check "bl-303 supervisor-recovery-02 [elapsed]: re-armed to running" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :status]")" == running ]]'
check "bl-303 supervisor-recovery-02 [elapsed]: attempts reset to a fresh budget (1, not stuck at/past the old cap)" \
  '[[ "$(jget "$F/.swarmforge/operator/front-desk-supervisor.status.json" "[:bot :attempts]")" -eq 1 ]]'
unset FRONT_DESK_MAX_ATTEMPTS FRONT_DESK_BACKOFF_BASE_MS FRONT_DESK_BACKOFF_MAX_MS FRONT_DESK_GIVEUP_COOLDOWN_MS
cleanup_children "$F"
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "front_desk_supervisor smoke: ALL CHECKS PASSED"
else
  echo "front_desk_supervisor smoke: FAILURES"; exit 1
fi
