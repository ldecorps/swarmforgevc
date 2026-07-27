#!/usr/bin/env bash
# BL-684 scenario 07: a pre-rename heartbeat is never read as current
# liveness. Seeds a GENUINELY FRESH old-named heartbeat file (timestamped
# "now", not stale by any clock) alongside a real supervised process that
# writes no heartbeat of its own, then proves the supervisor still reports
# the process as stalled once the stall window elapses - the only way that
# happens is if read-poll-heartbeat-ms never consulted the old file. A
# mocked heartbeat read could not catch a supervisor that quietly fell
# back to the old path; this drives the real onboarder_supervisor.bb.
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
  cp "$SRC/onboarder_supervisor.bb" "$SRC/front_desk_supervisor_lib.bb" \
     "$SRC/swarm_identity_lib.bb" "$SRC/fleet_telegram_creds_lib.bb" "$d/swarm/"
  # A real supervised child that stays alive but writes NO heartbeat of its
  # own - isolates the assertion to "did the supervisor consult the old
  # file", never "did the real reconcile loop's own heartbeat save it".
  cat > "$d/swarm/extension/out/tools/onboarder-reconcile.js" <<'EOF'
setInterval(() => {}, 1000);
EOF
  printf '%s' "$d"
}

STATUS() { echo "$1/swarm/.swarmforge/operator/onboarder-supervisor.status.json"; }
jget() { bb -e "(require '[cheshire.core :as j]) (println (get-in (j/parse-string (slurp \"$1\") true) $2))"; }
check_once() {
  SWARMFORGE_FLEET_HOME="$1/fleet-home" TELEGRAM_BOT_TOKEN=fake-token TELEGRAM_CHAT_ID=fake-chat \
    ONBOARDER_STALL_MS="${ONBOARDER_STALL_MS:-200}" \
    bb "$1/swarm/onboarder_supervisor.bb" "$1/swarm" --check-once
}

F="$(make_fixture)"
now_ms=$(( $(date +%s) * 1000 ))
echo "{\"lastHeartbeatMs\": $now_ms}" > "$F/swarm/.swarmforge/operator/onboarding-facilitator-heartbeat.json"

check_once "$F" > /dev/null
check "first check-once starts the supervised process" \
  '[[ "$(jget "$(STATUS "$F")" "[:onboarder :status]")" == running ]]'

sleep 0.5
check_once "$F" > /dev/null
check "a genuinely fresh OLD-named heartbeat never counts as current - the process reads as stalled once the window elapses" \
  '[[ "$(jget "$(STATUS "$F")" "[:onboarder :status]")" == stalled ]]'
check "the old-named heartbeat file itself is untouched (never read, never written by the supervisor)" \
  '[[ "$(jget "$F/swarm/.swarmforge/operator/onboarding-facilitator-heartbeat.json" "[:lastHeartbeatMs]")" -eq "$now_ms" ]]'
check "no new-named heartbeat file was ever created (the fake reconcile writes none)" \
  '[[ ! -f "$F/swarm/.swarmforge/operator/onboarder-heartbeat.json" ]]'

pkill -f "$F/swarm/extension/out/tools/onboarder-reconcile.js" 2>/dev/null || true
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "PASSED: test_onboarder_supervisor_ignores_old_heartbeat.sh"
else
  note "FAILED: test_onboarder_supervisor_ignores_old_heartbeat.sh"
  exit 1
fi
