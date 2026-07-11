#!/usr/bin/env bash
# Smoke test for launch_front_desk.sh (BL-292). Per the ticket's own
# explicit constraint (the exact BL-275 gap: a dry-run smoke test that only
# string-matches a printed path is not proof the path exists), every
# entrypoint referenced by the dry-run output is verified with a REAL `-f`
# check against the filesystem, not just a grep on the printed command.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
LAUNCHER="$SRC/launch_front_desk.sh"

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/extension/out/tools" "$d/.swarmforge/operator"
  printf '' > "$d/extension/out/tools/start-bridge-headless.js"
  printf '' > "$d/extension/out/tools/telegram-front-desk-bot.js"
  printf '%s' "$d"
}

# ── 1. dry-run: prints a bridge command and a bot command, and BOTH
#      referenced entrypoints are real files on disk (-f, not string match) ──
F="$(make_fixture)"
DRY="$(FRONT_DESK_LAUNCH_DRYRUN=1 bash "$LAUNCHER" "$F" 2>&1)"
check "dry-run prints a bridge command"                     '[[ "$DRY" == *"DRYRUN bridge cmd:"* ]]'
check "dry-run prints a bot command"                        '[[ "$DRY" == *"DRYRUN bot cmd:"* ]]'
check "the bot command carries <bridgeUrl> <targetPath>"    '[[ "$DRY" == *"http://127.0.0.1:8765 $F"* ]]'
check "the bot command's env line names every required var" \
  '[[ "$DRY" == *"TELEGRAM_BOT_TOKEN"* && "$DRY" == *"TELEGRAM_CHAT_ID"* && "$DRY" == *"TELEGRAM_PRINCIPAL_USER_ID"* && "$DRY" == *"BRIDGE_TOKEN"* && "$DRY" == *"BRIDGE_CONTROL_TOKEN"* ]]'
# The BL-275 gap, closed: real -f checks on the exact paths the dry-run
# output itself named, not a substring match on the printed command.
check "the referenced bridge entrypoint file actually EXISTS (-f, real check)" \
  '[[ -f "$F/extension/out/tools/start-bridge-headless.js" ]]'
check "the referenced bot entrypoint file actually EXISTS (-f, real check)" \
  '[[ -f "$F/extension/out/tools/telegram-front-desk-bot.js" ]]'
check "dry-run starts nothing (no supervisor pid file written)" \
  '[[ ! -f "$F/.swarmforge/operator/front-desk-supervisor.pid" ]]'
rm -rf "$F"

# ── 2. token provisioning: generated once, persisted, machine-local (never
#      in the repo - mode 600), reused verbatim across dry-run calls ────────
F="$(make_fixture)"
FRONT_DESK_LAUNCH_DRYRUN=1 bash "$LAUNCHER" "$F" > /dev/null
check "a bridge token file is provisioned"                  '[[ -f "$F/.swarmforge/operator/bridge-token" ]]'
check "the token file is not group/world readable (mode 600)" \
  '[[ "$(stat -c %a "$F/.swarmforge/operator/bridge-token" 2>/dev/null || stat -f %A "$F/.swarmforge/operator/bridge-token")" == "600" ]]'
TOKEN1="$(cat "$F/.swarmforge/operator/bridge-token")"
FRONT_DESK_LAUNCH_DRYRUN=1 bash "$LAUNCHER" "$F" > /dev/null
TOKEN2="$(cat "$F/.swarmforge/operator/bridge-token")"
check "the SAME token is reused across launches, never regenerated" \
  '[[ "$TOKEN1" == "$TOKEN2" ]]'
rm -rf "$F"

# ── 3. missing compiled entrypoint fails loudly (real launch, not dry-run) ──
F="$(make_fixture)"
rm -f "$F/extension/out/tools/start-bridge-headless.js"
OUT="$(TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=y TELEGRAM_PRINCIPAL_USER_ID=1 bash "$LAUNCHER" "$F" 2>&1)" && rc=0 || rc=$?
check "a missing compiled bridge entrypoint fails the real launch, not silently" \
  '[[ "$rc" -ne 0 && "$OUT" == *"bridge entrypoint not found"* ]]'
rm -rf "$F"

# ── 4. missing Telegram env fails loudly before spawning anything ───────────
F="$(make_fixture)"
OUT="$(bash "$LAUNCHER" "$F" 2>&1)" && rc=0 || rc=$?
check "a missing TELEGRAM_BOT_TOKEN fails the real launch with a clear message" \
  '[[ "$rc" -ne 0 && "$OUT" == *"TELEGRAM_BOT_TOKEN"* ]]'
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "launch_front_desk smoke: ALL CHECKS PASSED"
else
  echo "launch_front_desk smoke: FAILURES"; exit 1
fi
