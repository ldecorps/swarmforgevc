#!/usr/bin/env bash
# Smoke test for the Onboarding Facilitator supervisor
# (onboarding_facilitator_supervisor.bb, BL-590). Mirrors
# test_negotiation_relay_supervisor_tick.sh's own shape (real child
# processes, real liveness checks, a fake compiled entrypoint instead of
# live Telegram credentials) but for this supervisor's single
# :onboarding-facilitator process-spec and its swarm-repo-root-only
# argument (no per-target path - the Onboarding topic lives in the PRIMARY
# swarm's own group).
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
  mkdir -p "$d/swarm/extension/out/tools" "$d/swarm/.swarmforge/operator" "$d/fleet-home"
  cp "$SRC/onboarding_facilitator_supervisor.bb" "$SRC/front_desk_supervisor_lib.bb" \
     "$SRC/swarm_identity_lib.bb" "$SRC/fleet_telegram_creds_lib.bb" "$d/swarm/"
  write_healthy_reconcile_js "$d"
  printf '%s' "$d"
}

# A "healthy" fake reconcile CLI must write the SAME heartbeat shape the
# real onboarding-facilitator-reconcile.ts writes - without it, a process
# that merely stays alive reads as stalled (nil heartbeat counts as stale),
# which would falsely trip every "stays running" assertion below.
# swarm-repo-root is process.argv[2] (poll-loop's own first CLI arg).
write_healthy_reconcile_js() {
  cat > "$1/swarm/extension/out/tools/onboarding-facilitator-reconcile.js" <<'EOF'
const fs = require('fs');
const path = require('path');
const root = process.argv[2] || '.';
const hbPath = path.join(root, '.swarmforge', 'operator', 'onboarding-facilitator-heartbeat.json');
function beat() {
  fs.mkdirSync(path.dirname(hbPath), { recursive: true });
  fs.writeFileSync(hbPath, JSON.stringify({ lastHeartbeatMs: Date.now() }));
}
beat();
setInterval(beat, 200);
EOF
}

STATUS() { echo "$1/swarm/.swarmforge/operator/onboarding-facilitator-supervisor.status.json"; }

check_once() {
  SWARMFORGE_FLEET_HOME="$1/fleet-home" \
    TELEGRAM_BOT_TOKEN=fake-token \
    TELEGRAM_CHAT_ID=fake-chat \
    ONBOARDING_FACILITATOR_MAX_ATTEMPTS="${ONBOARDING_FACILITATOR_MAX_ATTEMPTS:-3}" \
    ONBOARDING_FACILITATOR_BACKOFF_BASE_MS="${ONBOARDING_FACILITATOR_BACKOFF_BASE_MS:-10}" \
    ONBOARDING_FACILITATOR_BACKOFF_MAX_MS="${ONBOARDING_FACILITATOR_BACKOFF_MAX_MS:-40}" \
    bb "$1/swarm/onboarding_facilitator_supervisor.bb" "$1/swarm" --check-once
}
jget() { bb -e "(require '[cheshire.core :as j]) (println (get-in (j/parse-string (slurp \"$1\") true) $2))"; }
cleanup_children() {
  pkill -f "$1/swarm/extension/out/tools/onboarding-facilitator-reconcile.js" 2>/dev/null || true
}

# ── 1. first check-once: the reconcile loop is started, attempt 1, running ──
F="$(make_fixture)"
check_once "$F" > /dev/null
check "first check-once starts the reconcile loop (attempt 1, running)" \
  '[[ "$(jget "$(STATUS "$F")" "[:onboarding-facilitator :status]")" == running ]]'
check "status.json records attempt 1" \
  '[[ "$(jget "$(STATUS "$F")" "[:onboarding-facilitator :attempts]")" -eq 1 ]]'

# ── 2. a second check-once (nothing crashed) leaves it alone at attempt 1 ───
check_once "$F" > /dev/null
check "a healthy process is never restarted (still attempt 1)" \
  '[[ "$(jget "$(STATUS "$F")" "[:onboarding-facilitator :attempts]")" -eq 1 ]]'
cleanup_children "$F"
rm -rf "$F"

# ── 3. a crashed process is detected, waits out its backoff, then restarts
#      (bounded) - and after the configured cap, gives up ──────────────────
F="$(make_fixture)"
cat > "$F/swarm/extension/out/tools/onboarding-facilitator-reconcile.js" <<'EOF'
process.exit(1);
EOF
export ONBOARDING_FACILITATOR_MAX_ATTEMPTS=2 ONBOARDING_FACILITATOR_BACKOFF_BASE_MS=10 ONBOARDING_FACILITATOR_BACKOFF_MAX_MS=20
check_once "$F" > /dev/null
check "attempt 1 starts (briefly) before crashing" \
  '[[ "$(jget "$(STATUS "$F")" "[:onboarding-facilitator :attempts]")" -eq 1 ]]'
sleep 0.2
check_once "$F" > /dev/null
check "a crashed process is detected and moved to waiting-or-restarted" \
  '[[ "$(jget "$(STATUS "$F")" "[:onboarding-facilitator :status]")" != running ]] || [[ "$(jget "$(STATUS "$F")" "[:onboarding-facilitator :attempts]")" -gt 1 ]]'
gave_up=0
for _ in $(seq 1 15); do
  sleep 0.2
  check_once "$F" > /dev/null
  if [[ "$(jget "$(STATUS "$F")" "[:onboarding-facilitator :status]")" == gave-up ]]; then
    gave_up=1
    break
  fi
done
check "after the bounded cap (max-attempts=2), the facilitator gives up rather than restarting forever" \
  '[[ "$gave_up" -eq 1 ]]'
check "the facilitator never exceeds the configured attempt cap" \
  '[[ "$(jget "$(STATUS "$F")" "[:onboarding-facilitator :attempts]")" -eq 2 ]]'
unset ONBOARDING_FACILITATOR_MAX_ATTEMPTS ONBOARDING_FACILITATOR_BACKOFF_BASE_MS ONBOARDING_FACILITATOR_BACKOFF_MAX_MS
cleanup_children "$F"
rm -rf "$F"

if [[ "$fail" -ne 0 ]]; then
  note "FAILED: test_onboarding_facilitator_supervisor_tick.sh"
  exit 1
fi
note "PASSED: test_onboarding_facilitator_supervisor_tick.sh"
