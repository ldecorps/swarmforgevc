#!/usr/bin/env bash
# Smoke test for launch_negotiation_relay.sh (BL-381 QA bounce). Mirrors
# test_launch_front_desk.sh's own shape: every entrypoint the dry-run output
# names is verified with a real `-f` check, not a string match on the
# printed command (the BL-275 gap that rule exists to close).
#
# The launcher resolves its OWN "swarm repo root" from its own script
# location (SCRIPT_DIR/../..), never from an argument - so a fixture must
# put a copy of the launcher + supervisor + reused libs under
# <fixture>/swarmforge/scripts/, exactly mirroring the real repo layout,
# with the fixture root standing in for the swarm repo. The TARGET repo
# path is a separate directory, passed explicitly as an argument, matching
# production (a target is a different filesystem path from the swarm repo).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_swarm_fixture() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/swarmforge/scripts" "$d/extension/out/tools"
  cp "$SRC/launch_negotiation_relay.sh" "$SRC/negotiation_relay_supervisor.bb" \
     "$SRC/front_desk_supervisor_lib.bb" "$SRC/operator_lib.bb" "$SRC/daemon_alarm_lib.bb" \
     "$d/swarmforge/scripts/"
  printf '' > "$d/extension/out/tools/relay-onboarding-negotiation-telegram.js"
  printf '%s' "$d"
}

LAUNCHER_IN() { echo "$1/swarmforge/scripts/launch_negotiation_relay.sh"; }

# ── 1. dry-run: prints a supervisor command and a relay command, and the
#      referenced entrypoint is a real file on disk (-f, not string match) ──
SWARM="$(make_swarm_fixture)"
TARGET="$(mktemp -d)"
DRY="$(NEGOTIATION_RELAY_LAUNCH_DRYRUN=1 bash "$(LAUNCHER_IN "$SWARM")" "$TARGET" "$TARGET/secrets.json" 2>&1)"
check "dry-run prints a supervisor command"                 '[[ "$DRY" == *"DRYRUN supervisor cmd:"* ]]'
check "dry-run prints a relay command"                      '[[ "$DRY" == *"DRYRUN relay cmd:"* ]]'
check "the relay command carries <target> <secrets> poll-loop" \
  '[[ "$DRY" == *"$TARGET $TARGET/secrets.json poll-loop"* ]]'
check "the relay command's env line names TELEGRAM_PRINCIPAL_USER_ID" \
  '[[ "$DRY" == *"TELEGRAM_PRINCIPAL_USER_ID"* ]]'
check "the referenced relay entrypoint file actually EXISTS (-f, real check)" \
  '[[ -f "$SWARM/extension/out/tools/relay-onboarding-negotiation-telegram.js" ]]'
check "dry-run starts nothing (no supervisor pid file written)" \
  '[[ ! -f "$TARGET/.swarmforge/operator/negotiation-relay-supervisor.pid" ]]'
rm -rf "$SWARM" "$TARGET"

# ── 2. missing compiled entrypoint fails loudly (real launch, not dry-run) ──
SWARM="$(make_swarm_fixture)"
TARGET="$(mktemp -d)"
rm -f "$SWARM/extension/out/tools/relay-onboarding-negotiation-telegram.js"
OUT="$(TELEGRAM_PRINCIPAL_USER_ID=1 bash "$(LAUNCHER_IN "$SWARM")" "$TARGET" "$TARGET/secrets.json" 2>&1)" && rc=0 || rc=$?
check "a missing compiled relay entrypoint fails the real launch, not silently" \
  '[[ "$rc" -ne 0 && "$OUT" == *"relay entrypoint not found"* ]]'
rm -rf "$SWARM" "$TARGET"

# ── 3. missing TELEGRAM_PRINCIPAL_USER_ID fails loudly before spawning
#      anything - this box's own shell may export the REAL var globally
#      (same trap telegramFrontDeskBotCli.test.js's own comment documents),
#      so it must be explicitly unset for the launch to see it as missing ──
SWARM="$(make_swarm_fixture)"
TARGET="$(mktemp -d)"
OUT="$(env -u TELEGRAM_PRINCIPAL_USER_ID bash "$(LAUNCHER_IN "$SWARM")" "$TARGET" "$TARGET/secrets.json" 2>&1)" && rc=0 || rc=$?
check "a missing TELEGRAM_PRINCIPAL_USER_ID fails the real launch with a clear message" \
  '[[ "$rc" -ne 0 && "$OUT" == *"TELEGRAM_PRINCIPAL_USER_ID"* ]]'
rm -rf "$SWARM" "$TARGET"

# ── 4. idempotent: an already-running supervisor is never double-launched ───
SWARM="$(make_swarm_fixture)"
TARGET="$(mktemp -d)"
mkdir -p "$TARGET/.swarmforge/operator"
sleep 300 &
FAKE_PID=$!
echo "$FAKE_PID" > "$TARGET/.swarmforge/operator/negotiation-relay-supervisor.pid"
OUT="$(TELEGRAM_PRINCIPAL_USER_ID=1 bash "$(LAUNCHER_IN "$SWARM")" "$TARGET" "$TARGET/secrets.json" 2>&1)" && rc=0 || rc=$?
check "an already-running supervisor is not double-launched (exits 0, says so)" \
  '[[ "$rc" -eq 0 && "$OUT" == *"already running"* ]]'
kill "$FAKE_PID" 2>/dev/null || true
rm -rf "$SWARM" "$TARGET"

if [[ "$fail" -eq 0 ]]; then
  echo "launch_negotiation_relay smoke: ALL CHECKS PASSED"
else
  echo "launch_negotiation_relay smoke: FAILURES"; exit 1
fi
