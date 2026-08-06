#!/usr/bin/env bash
# Smoke test for launch_front_desk.sh (BL-292). Per the ticket's own
# explicit constraint (the exact BL-275 gap: a dry-run smoke test that only
# string-matches a printed path is not proof the path exists), every
# entrypoint referenced by the dry-run output is verified with a REAL `-f`
# check against the filesystem, not just a grep on the printed command.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
LAUNCHER="$SRC/launch_front_desk.sh"

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
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

# ── 4. BL-622: missing TELEGRAM_BOT_TOKEN/CHAT_ID no longer fails at this
#      script's own gate - resolution (and any refusal) is delegated to
#      front_desk_supervisor.bb itself (see test_front_desk_supervisor_
#      bl622_refusal.sh for the supervisor-level refusal proof). A swarm
#      with its own fleet creds file must still be able to launch from a
#      shell with zero ambient Telegram env - e.g. swarm_ensure's stale-
#      pid-file repair path, BL-622 scenario 06. Proven WITHOUT spawning the
#      real supervisor (which would need an isolated fleet home and process
#      cleanup): with the compiled bridge entrypoint deliberately missing,
#      the OLD code would have died on "TELEGRAM_BOT_TOKEN is not set"
#      before ever reaching the entrypoint check; this proves the new code
#      reaches PAST the (now-removed) token gate and fails on the
#      entrypoint instead - not just that the launch fails for SOME reason.
# `env -u` guarantees these are actually absent regardless of the calling
# shell's own exported vars (a dev box routinely has real TELEGRAM_BOT_TOKEN
# etc. set globally).
F="$(make_fixture)"
rm -f "$F/extension/out/tools/start-bridge-headless.js"
OUT="$(env -u TELEGRAM_BOT_TOKEN -u TELEGRAM_CHAT_ID TELEGRAM_PRINCIPAL_USER_ID=1 bash "$LAUNCHER" "$F" 2>&1)" && rc=0 || rc=$?
check "missing TELEGRAM_BOT_TOKEN/CHAT_ID reaches past the old gate (fails on the entrypoint, not the token)" \
  '[[ "$rc" -ne 0 && "$OUT" == *"bridge entrypoint not found"* && "$OUT" != *"TELEGRAM_BOT_TOKEN is not set"* ]]'
rm -rf "$F"

# ── 4b. TELEGRAM_PRINCIPAL_USER_ID is still hard-required at this script's
#       own gate (unrelated to BL-622 - the bot's own CLI needs it
#       regardless of where the token came from) ───────────────────────────
F="$(make_fixture)"
OUT="$(env -u TELEGRAM_PRINCIPAL_USER_ID TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=y bash "$LAUNCHER" "$F" 2>&1)" && rc=0 || rc=$?
check "a missing TELEGRAM_PRINCIPAL_USER_ID still fails the real launch with a clear message" \
  '[[ "$rc" -ne 0 && "$OUT" == *"TELEGRAM_PRINCIPAL_USER_ID"* ]]'
rm -rf "$F"

# ── 4c. BL-622 end-to-end through THIS script's own real supervisor spawn:
#       a non-primary swarm with an inherited (leaked) primary token is
#       refused by front_desk_supervisor.bb, and this script's own
#       kill-0/supervisor_launcher_pid wiring (added by BL-622, never
#       exercised above - 4/4b prove only the entrypoint-check ordering,
#       and test_front_desk_supervisor_bl622_refusal.sh drives the
#       supervisor directly, never through this launcher) detects the
#       supervisor's fast exit and reports the failure well under the full
#       PID_WAIT_ATTEMPTS timeout, not just eventually. PID_WAIT_ATTEMPTS is
#       set far above what a refusal should ever take, so a real regression
#       (the kill-0 break deleted or inverted, silently falling through to
#       the full wait) would show up as slow, not just eventually-correct.
F="$(make_fixture)"
mkdir -p "$F/.swarmforge"
printf 'swarm_name\tsecondary\nswarm_mode\tautonomous\n' > "$F/.swarmforge/swarm-identity"
FLEET_HOME="$(mktemp -d)"; register_tmp_dir "$FLEET_HOME"
# Deliberately: no primary/root record and no per-swarm creds file under
# FLEET_HOME - the exact rogue/uninitialized-swarm shape BL-622 closes.
# SECONDS is a bash builtin (portable, no external `date +%N` - unsupported
# on BSD/macOS date) with 1s granularity, plenty for a <1s-vs-60s check.
SECONDS=0
OUT="$(SWARMFORGE_FLEET_HOME="$FLEET_HOME" PID_WAIT_ATTEMPTS=600 \
  TELEGRAM_BOT_TOKEN=leaked-primary-token TELEGRAM_CHAT_ID=leaked-primary-chat \
  TELEGRAM_PRINCIPAL_USER_ID=1 bash "$LAUNCHER" "$F" 2>&1)" && rc=0 || rc=$?
elapsed_s=$SECONDS
check "4c: a non-primary swarm with a leaked primary token is refused (non-zero exit)" \
  '[[ "$rc" -ne 0 ]]'
check "4c: no pid file is ever claimed (front desk does not launch)" \
  '[[ ! -f "$F/.swarmforge/operator/front-desk-supervisor.pid" ]]'
check "4c: the failure is reported with the supervisor log tail, not a bare timeout message" \
  '[[ "$OUT" == *"failed to claim its own pid file"* && "$OUT" == *"last lines of"* ]]'
check "4c: the log tail carries the loud refusal line naming this swarm" \
  '[[ "$OUT" == *"secondary"* ]]'
# PID_WAIT_ATTEMPTS=600 (60s of full waiting) but the kill-0 fast-exit
# should report in a couple seconds of supervisor-exit-detection overhead;
# 10s leaves ample headroom for host load while still failing hard if the
# fast path regresses to the full 60s wait.
check "4c: the refusal is detected fast via kill-0, not by exhausting PID_WAIT_ATTEMPTS (${elapsed_s}s)" \
  '[[ "$elapsed_s" -lt 10 ]]'
rm -rf "$F"

# ── 5. BL-404: front-desk-PARKED.md refuses the launch, even with zero env ──
#      set and no compiled entrypoints - the park check must win before any
#      of the earlier guards get a chance to fail for a different reason.
F="$(make_fixture)"
mkdir -p "$F/.swarmforge/operator"
printf 'DO NOT RESTART\n' > "$F/.swarmforge/operator/front-desk-PARKED.md"
touch "$F/.swarmforge/operator/front-desk-supervisor.stop"
OUT="$(bash "$LAUNCHER" "$F" 2>&1)" && rc=0 || rc=$?
check "PARKED launch exits 0"                                '[[ "$rc" -eq 0 ]]'
check "PARKED launch logs a clear PARKED message"            '[[ "$OUT" == *"PARKED"* ]]'
check "PARKED launch does not spawn a supervisor (no pid file)" \
  '[[ ! -f "$F/.swarmforge/operator/front-desk-supervisor.pid" ]]'
rm -rf "$F"

# ── 6. the park flag and .stop file are left untouched by a refused launch ──
F="$(make_fixture)"
mkdir -p "$F/.swarmforge/operator"
printf 'DO NOT RESTART\n' > "$F/.swarmforge/operator/front-desk-PARKED.md"
touch "$F/.swarmforge/operator/front-desk-supervisor.stop"
bash "$LAUNCHER" "$F" > /dev/null 2>&1 || true
check "PARKED launch leaves the park flag in place"          '[[ -f "$F/.swarmforge/operator/front-desk-PARKED.md" ]]'
check "PARKED launch does not remove front-desk-supervisor.stop" \
  '[[ -f "$F/.swarmforge/operator/front-desk-supervisor.stop" ]]'
rm -rf "$F"

# ── 7. once the park flag is gone, launch proceeds normally again ──────────
F="$(make_fixture)"
DRY="$(FRONT_DESK_LAUNCH_DRYRUN=1 bash "$LAUNCHER" "$F" 2>&1)"
check "no park flag: dry-run launches normally"              '[[ "$DRY" == *"DRYRUN bridge cmd:"* ]]'
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "launch_front_desk smoke: ALL CHECKS PASSED"
else
  echo "launch_front_desk smoke: FAILURES"; exit 1
fi
