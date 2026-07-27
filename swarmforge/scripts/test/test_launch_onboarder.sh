#!/usr/bin/env bash
# BL-684: smoke test for launch_onboarder.sh's own guards. Mirrors
# test_launch_negotiation_relay.sh's shape (real entrypoint file checks,
# real fake pids via `sleep N &`, never a mocked pid-alive check) plus the
# rename-specific guard this ticket adds: a pre-rename supervisor holding
# the OLD-named pid file must block a second launch WITHOUT this launcher
# ever adopting, killing or migrating it (invariant 2).
#
# launch_onboarder.sh takes ONE arg (swarm-repo-root, unlike
# launch_negotiation_relay.sh's target+secrets pair) - the same root serves
# swarmforge/scripts/, extension/out/tools/, and .swarmforge/operator/, so
# one fixture directory covers all three.
set -euo pipefail
set +m
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/swarmforge/scripts" "$d/extension/out/tools" "$d/.swarmforge/operator"
  cp "$SRC/launch_onboarder.sh" "$SRC/onboarder_supervisor.bb" \
     "$SRC/front_desk_supervisor_lib.bb" "$SRC/swarm_identity_lib.bb" "$SRC/fleet_telegram_creds_lib.bb" \
     "$d/swarmforge/scripts/"
  printf '' > "$d/extension/out/tools/onboarder-reconcile.js"
  printf '%s' "$d"
}

LAUNCHER_IN() { echo "$1/swarmforge/scripts/launch_onboarder.sh"; }
OLD_PID_FILE_IN() { echo "$1/.swarmforge/operator/onboarding-facilitator-supervisor.pid"; }
NEW_PID_FILE_IN() { echo "$1/.swarmforge/operator/onboarder-supervisor.pid"; }

# ── 1. dry-run: prints a supervisor command, starts nothing ─────────────────
F="$(make_fixture)"
DRY="$(ONBOARDER_LAUNCH_DRYRUN=1 bash "$(LAUNCHER_IN "$F")" "$F" 2>&1)"
check "dry-run prints a supervisor command"           '[[ "$DRY" == *"DRYRUN supervisor cmd:"* ]]'
check "dry-run prints a reconcile command"             '[[ "$DRY" == *"DRYRUN reconcile cmd:"* ]]'
check "dry-run starts nothing (no pid file written)"   '[[ ! -f "$(NEW_PID_FILE_IN "$F")" ]]'
rm -rf "$F"

# ── 2. missing compiled entrypoint fails loudly (real launch, not dry-run) ──
F="$(make_fixture)"
rm -f "$F/extension/out/tools/onboarder-reconcile.js"
OUT="$(bash "$(LAUNCHER_IN "$F")" "$F" 2>&1)" && rc=0 || rc=$?
check "a missing compiled reconcile entrypoint fails the real launch, not silently" \
  '[[ "$rc" -ne 0 && "$OUT" == *"reconcile entrypoint not found"* ]]'
rm -rf "$F"

# ── 3. a pre-rename supervisor holding the OLD-named pid file blocks a
#      second launch - the launcher declines and reports, never adopts,
#      kills or migrates it (invariant 2, scenario 03) ─────────────────────
F="$(make_fixture)"
sleep 300 &
OLD_PID=$!
mkdir -p "$F/.swarmforge/operator"
echo "$OLD_PID" > "$(OLD_PID_FILE_IN "$F")"
OUT="$(bash "$(LAUNCHER_IN "$F")" "$F" 2>&1)" && rc=0 || rc=$?
check "declines to start beside a live pre-rename supervisor (exits 0, says so)" \
  '[[ "$rc" -eq 0 && "$OUT" == *"pre-rename supervisor is already running"* ]]'
check "reports the old-named live pid as the reason" \
  '[[ "$OUT" == *"pid $OLD_PID"* ]]'
check "never starts a second (new-named) supervisor" \
  '[[ ! -f "$(NEW_PID_FILE_IN "$F")" ]]'
check "the pre-rename supervisor is left running and untouched" \
  'kill -0 "$OLD_PID" 2>/dev/null'
kill "$OLD_PID" 2>/dev/null || true
rm -rf "$F"

# ── 4. an old-named pid file that is NOT alive never blocks a start
#      (scenario 05: dead process / not a number / empty file) - proven
#      against the REAL supervisor, so a real pid claim is the evidence,
#      never a mocked pid-alive check ────────────────────────────────────
for old_pid_value_desc in "a dead process:__DEAD__" "not a number:not-a-number" "an empty file:"; do
  desc="${old_pid_value_desc%%:*}"
  value="${old_pid_value_desc#*:}"
  F="$(make_fixture)"
  mkdir -p "$F/.swarmforge/operator"
  if [[ "$value" == "__DEAD__" ]]; then
    sleep 0.01 &
    dead_pid=$!
    wait "$dead_pid" 2>/dev/null || true
    echo "$dead_pid" > "$(OLD_PID_FILE_IN "$F")"
  else
    printf '%s' "$value" > "$(OLD_PID_FILE_IN "$F")"
  fi
  OUT="$(TELEGRAM_BOT_TOKEN=fake-token TELEGRAM_CHAT_ID=fake-chat \
    SWARMFORGE_FLEET_HOME="$F" \
    bash "$(LAUNCHER_IN "$F")" "$F" 2>&1)"
  check "an old-named pid file that is $desc never blocks a start" \
    '[[ -f "$(NEW_PID_FILE_IN "$F")" ]]'
  # Cleanup: stop the real supervisor this test started.
  if [[ -f "$(NEW_PID_FILE_IN "$F")" ]]; then
    new_pid="$(< "$(NEW_PID_FILE_IN "$F")")"
    touch "$F/.swarmforge/operator/onboarder-supervisor.stop"
    sleep 0.3
    kill "$new_pid" 2>/dev/null || true
  fi
  pkill -f "$F/extension/out/tools/onboarder-reconcile.js" 2>/dev/null || true
  rm -rf "$F"
done

if [[ "$fail" -eq 0 ]]; then
  echo "launch_onboarder smoke: ALL CHECKS PASSED"
else
  echo "launch_onboarder smoke: FAILURES"; exit 1
fi
