#!/usr/bin/env bash
# BL-763: operator_runtime.bb's cursor-bridge-watchdog-sweep! - continuous
# liveness/heartbeat-freshness repair for the Cursor Remote bridge
# supervisor, same posture as the pre-existing miniapp-watchdog-sweep!
# (best-effort, cooldown-guarded, never gates launch). No test named this
# behavior before this parcel; added here per the hardener's own duty to
# cover uncovered changed behavior.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/operator_runtime_sandbox.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
LIVE_PIDS=()
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

cleanup_live_pids() {
  local p
  for p in "${LIVE_PIDS[@]:-}"; do
    [[ -n "$p" ]] && kill "$p" 2>/dev/null || true
  done
}
trap cleanup_live_pids EXIT

jget() { bb -e "(require '[cheshire.core :as j]) (println (get (j/parse-string (slurp \"$1\") true) $2))"; }
jget_in() { bb -e "(require '[cheshire.core :as j]) (println (get-in (j/parse-string (slurp \"$1\") true) $2))"; }

make_fixture() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge/operator" "$d/swarmforge/scripts"
  copy_operator_runtime_sandbox "$SRC" "$d/swarmforge/scripts"
  # start_cursor_bridge.sh is shelled out to (process/sh), never load-filed,
  # so the sandbox copy above never carries it - a stub is written per
  # fixture below, matching bounce_bridge_headless.sh's own stub pattern in
  # test_operator_runtime_tick.sh.
  cat > "$d/swarmforge/scripts/start_cursor_bridge.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:?root required}"
mkdir -p "$ROOT/.swarmforge/operator"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$ROOT/.swarmforge/operator/cursor-bridge-restarted.marker"
EOF
  chmod +x "$d/swarmforge/scripts/start_cursor_bridge.sh"
  printf '%s' "$d"
}

tick() {
  local root="$1"; shift
  OPERATOR_SKIP_LAUNCH=1 OPERATOR_MINIAPP_WATCHDOG_ENABLED=0 \
    SWARMFORGE_SANDBOX_SWEEP_ROOT="$root/.no-sandbox-sweep" SWARMFORGE_FIXTURE_REAP_ROOT="$root/.no-fixture-reap" \
    SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS="" \
    "$@" bb "$root/swarmforge/scripts/operator_runtime.bb" "$root" --tick-once
}

restarted_count() {
  wc -l < "$1/.swarmforge/operator/cursor-bridge-restarted.marker" 2>/dev/null || echo 0
}

# ── 01: no supervisor pid file at all -> down -> restart attempted ─────────
F1="$(make_fixture)"
tick "$F1" env OPERATOR_CURSOR_BRIDGE_WATCHDOG_ENABLED=1 OPERATOR_CURSOR_BRIDGE_RESTART_COOLDOWN_MS=0 >/dev/null
check "01: missing supervisor pid file triggers a restart attempt" \
  '[[ -f "$F1/.swarmforge/operator/cursor-bridge-restarted.marker" ]]'
check "01: watchdog state records the restart timestamp" \
  '[[ "$(jget "$F1/.swarmforge/operator/cursor-bridge-watchdog.json" ":last_restart_at_ms")" != nil ]]'
check "01: published status names state down before the restart's own effect is observed" \
  '[[ "$(jget_in "$F1/.swarmforge/operator/status.json" "[:cursor_bridge_watchdog :state]")" == down ]]'

# ── 02: supervisor alive + fresh heartbeat -> healthy, no restart ──────────
F2="$(make_fixture)"
sleep 30 & SUP2_PID=$!
LIVE_PIDS+=("$SUP2_PID")
echo "$SUP2_PID" > "$F2/.swarmforge/operator/cursor-bridge-supervisor.pid"
NOW_MS="$(($(date +%s) * 1000))"
printf '{"lastHeartbeatMs": %s}\n' "$NOW_MS" > "$F2/.swarmforge/operator/cursor-bridge-heartbeat.json"
tick "$F2" env OPERATOR_CURSOR_BRIDGE_WATCHDOG_ENABLED=1 OPERATOR_CURSOR_BRIDGE_STALL_MS=120000 OPERATOR_CURSOR_BRIDGE_RESTART_COOLDOWN_MS=0 >/dev/null
check "02: a live supervisor with a fresh heartbeat is never restarted" \
  '[[ ! -f "$F2/.swarmforge/operator/cursor-bridge-restarted.marker" ]]'
check "02: published status names state healthy" \
  '[[ "$(jget_in "$F2/.swarmforge/operator/status.json" "[:cursor_bridge_watchdog :state]")" == healthy ]]'

# ── 03: supervisor alive but heartbeat stale -> restart (frozen-tick-loop
#    shape, pid-alive alone is not trusted) ─────────────────────────────────
F3="$(make_fixture)"
sleep 30 & SUP3_PID=$!
LIVE_PIDS+=("$SUP3_PID")
echo "$SUP3_PID" > "$F3/.swarmforge/operator/cursor-bridge-supervisor.pid"
STALE_MS="$(( $(date +%s) * 1000 - 300000 ))"
printf '{"lastHeartbeatMs": %s}\n' "$STALE_MS" > "$F3/.swarmforge/operator/cursor-bridge-heartbeat.json"
tick "$F3" env OPERATOR_CURSOR_BRIDGE_WATCHDOG_ENABLED=1 OPERATOR_CURSOR_BRIDGE_STALL_MS=120000 OPERATOR_CURSOR_BRIDGE_RESTART_COOLDOWN_MS=0 >/dev/null
check "03: an alive-but-stale-heartbeat supervisor is restarted anyway" \
  '[[ -f "$F3/.swarmforge/operator/cursor-bridge-restarted.marker" ]]'

# ── 04: cooldown guards against thrashing a restart every tick while still
#    unhealthy ──────────────────────────────────────────────────────────────
F4="$(make_fixture)"
tick "$F4" env OPERATOR_CURSOR_BRIDGE_WATCHDOG_ENABLED=1 OPERATOR_CURSOR_BRIDGE_RESTART_COOLDOWN_MS=600000 >/dev/null
FIRST_COUNT="$(restarted_count "$F4")"
tick "$F4" env OPERATOR_CURSOR_BRIDGE_WATCHDOG_ENABLED=1 OPERATOR_CURSOR_BRIDGE_RESTART_COOLDOWN_MS=600000 >/dev/null
SECOND_COUNT="$(restarted_count "$F4")"
check "04: first tick (still down, no cooldown yet) restarts once" '[[ "$FIRST_COUNT" -eq 1 ]]'
check "04: a second tick inside the cooldown window does not restart again" \
  '[[ "$SECOND_COUNT" -eq "$FIRST_COUNT" ]]'

# ── 05: disabled watchdog never restarts, even with no supervisor pid file,
#    and status names it disabled rather than down ─────────────────────────
F5="$(make_fixture)"
tick "$F5" env OPERATOR_CURSOR_BRIDGE_WATCHDOG_ENABLED=0 >/dev/null
check "05: disabled watchdog never attempts a restart" \
  '[[ ! -f "$F5/.swarmforge/operator/cursor-bridge-restarted.marker" ]]'
check "05: published status names state disabled, not down" \
  '[[ "$(jget_in "$F5/.swarmforge/operator/status.json" "[:cursor_bridge_watchdog :state]")" == disabled ]]'

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime BL-763 cursor-bridge-watchdog: ALL CHECKS PASSED"
else
  echo "operator_runtime BL-763 cursor-bridge-watchdog: FAILURES ABOVE"
  exit 1
fi
