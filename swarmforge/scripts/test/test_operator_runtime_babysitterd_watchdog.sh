#!/usr/bin/env bash
# Operator runtime tell-don't-restart babysitterd poll: process truth,
# pidfile lie, telegram announce path. Never calls start_babysitterd.sh
# (cron BL-675 remains the restarter). Matches babysitterd_freshness_lib.bb.
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
  mkdir -p "$d/.swarmforge/operator" "$d/.swarmforge/babysitterd" "$d/swarmforge/scripts"
  copy_operator_runtime_sandbox "$SRC" "$d/swarmforge/scripts"
  printf '[]\n' > "$d/.process-snapshot.json"
  # Tripwire: Operator must never spawn babysitterd. If this file is invoked,
  # the sweep grew a restart path.
  cat > "$d/swarmforge/scripts/start_babysitterd.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:?root required}"
mkdir -p "$ROOT/.swarmforge/operator"
echo "restarted" >> "$ROOT/.swarmforge/operator/babysitterd-restarted.marker"
EOF
  chmod +x "$d/swarmforge/scripts/start_babysitterd.sh"
  printf '%s' "$d"
}

start_fake_daemon() {
  local root="$1" pid
  cat > "$root/babysitterd.sh" <<'EOF'
#!/usr/bin/env bash
exec sleep 300
EOF
  chmod +x "$root/babysitterd.sh"
  # Must nohup+disown: callers capture this function's stdout in $(...),
  # which is a subshell — a bare `&` child dies with that subshell.
  nohup bash "$root/babysitterd.sh" "$root" >/dev/null 2>&1 &
  pid=$!
  disown "$pid" 2>/dev/null || true
  LIVE_PIDS+=("$pid")
  printf '[{"pid":%s,"cmdline":"bash %s/babysitterd.sh %s"}]\n' "$pid" "$root" "$root" \
    > "$root/.process-snapshot.json"
  printf '%s\n' "$pid"
}

tick() {
  local root="$1"; shift
  unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_PRINCIPAL_USER_ID \
        SWARMFORGE_SKIP_BABYSITTERD || true
  local empty_fleet="$root/.empty-fleet-home"
  mkdir -p "$empty_fleet"
  OPERATOR_SKIP_LAUNCH=1 OPERATOR_MINIAPP_WATCHDOG_ENABLED=0 \
    OPERATOR_CURSOR_BRIDGE_WATCHDOG_ENABLED=0 \
    SWARMFORGE_SKIP_BABYSITTERD=0 \
    SWARMFORGE_SANDBOX_SWEEP_ROOT="$root/.no-sandbox-sweep" \
    SWARMFORGE_FIXTURE_REAP_ROOT="$root/.no-fixture-reap" \
    SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS="" \
    SWARMFORGE_FLEET_HOME="$empty_fleet" \
    SWARMFORGE_BABYSITTERD_PROCESS_SNAPSHOT="$root/.process-snapshot.json" \
    "$@" bb "$root/swarmforge/scripts/operator_runtime.bb" "$root" --tick-once
}

never_restarted() {
  [[ ! -f "$1/.swarmforge/operator/babysitterd-restarted.marker" ]]
}

# ── 01: no process → down, tell, NEVER restart ────────────────────────────
F1="$(make_fixture)"
tick "$F1" env OPERATOR_BABYSITTERD_WATCHDOG_ENABLED=1 \
  OPERATOR_BABYSITTERD_WATCHDOG_COOLDOWN_MS=0 \
  TELEGRAM_BOT_TOKEN=t TELEGRAM_CHAT_ID=1 >/dev/null
check "01: missing daemon is state down" \
  '[[ "$(jget_in "$F1/.swarmforge/operator/status.json" "[:babysitterd_watchdog :state]")" == down ]]'
check "01: action is tell, not restart" \
  '[[ "$(jget_in "$F1/.swarmforge/operator/status.json" "[:babysitterd_watchdog :action]")" == tell ]]'
check "01: Operator never invoked start_babysitterd.sh" \
  'never_restarted "$F1"'
check "01: an alert was recorded" \
  '[[ "$(jget "$F1/.swarmforge/operator/babysitterd-watchdog.json" ":last_alert_at_ms")" != nil ]]'
check "01: a coordinator draft was written (tell path)" \
  '[[ -n "$(ls -A "$F1/.swarmforge/operator/babysitterd-watchdog-drafts" 2>/dev/null || true)" ]]'

# ── 02: live daemon + pidfile + telegram → healthy, no tell, no restart ───
F2="$(make_fixture)"
PID2="$(start_fake_daemon "$F2")"
kill -0 "$PID2" 2>/dev/null || { echo "FAIL - 02: fake daemon pid $PID2 is not alive"; fail=1; }
echo "$PID2" > "$F2/.swarmforge/babysitterd/babysitterd.pid"
tick "$F2" env OPERATOR_BABYSITTERD_WATCHDOG_ENABLED=1 \
  OPERATOR_BABYSITTERD_WATCHDOG_COOLDOWN_MS=0 \
  TELEGRAM_BOT_TOKEN=t TELEGRAM_CHAT_ID=1 >/dev/null
check "02: live daemon with pidfile is healthy" \
  '[[ "$(jget_in "$F2/.swarmforge/operator/status.json" "[:babysitterd_watchdog :state]")" == healthy ]]'
check "02: healthy action is none" \
  '[[ "$(jget_in "$F2/.swarmforge/operator/status.json" "[:babysitterd_watchdog :action]")" == none ]]'
check "02: healthy never restarts" 'never_restarted "$F2"'
check "02: healthy writes no alert" \
  '[[ "$(jget "$F2/.swarmforge/operator/babysitterd-watchdog.json" ":last_alert_at_ms")" == nil ]]'

# ── 03: live daemon, missing pidfile → pidfile-lie, tell, no restart ──────
F3="$(make_fixture)"
PID3="$(start_fake_daemon "$F3")"
tick "$F3" env OPERATOR_BABYSITTERD_WATCHDOG_ENABLED=1 \
  OPERATOR_BABYSITTERD_WATCHDOG_COOLDOWN_MS=0 \
  TELEGRAM_BOT_TOKEN=t TELEGRAM_CHAT_ID=1 >/dev/null
check "03: missing pidfile with a live process is pidfile-lie" \
  '[[ "$(jget_in "$F3/.swarmforge/operator/status.json" "[:babysitterd_watchdog :state]")" == pidfile-lie ]]'
check "03: published pid is the live orphan" \
  '[[ "$(jget_in "$F3/.swarmforge/operator/status.json" "[:babysitterd_watchdog :pid]")" == "$PID3" ]]'
check "03: pidfile-lie never restarts" 'never_restarted "$F3"'

# ── 04: live+pidfile but no telegram creds (isolated fleet home) → mute ───
F4="$(make_fixture)"
PID4="$(start_fake_daemon "$F4")"
echo "$PID4" > "$F4/.swarmforge/babysitterd/babysitterd.pid"
tick "$F4" env OPERATOR_BABYSITTERD_WATCHDOG_ENABLED=1 \
  OPERATOR_BABYSITTERD_WATCHDOG_COOLDOWN_MS=0 >/dev/null
check "04: missing telegram creds is announce-mute" \
  '[[ "$(jget_in "$F4/.swarmforge/operator/status.json" "[:babysitterd_watchdog :state]")" == announce-mute ]]'
check "04: announce-mute never restarts" 'never_restarted "$F4"'

# ── 05: SKIP_BABYSITTERD → disabled, no tell, no restart ──────────────────
F5="$(make_fixture)"
tick "$F5" env OPERATOR_BABYSITTERD_WATCHDOG_ENABLED=1 SWARMFORGE_SKIP_BABYSITTERD=1 \
  OPERATOR_BABYSITTERD_WATCHDOG_COOLDOWN_MS=0 >/dev/null
check "05: skip flag publishes disabled, not down" \
  '[[ "$(jget_in "$F5/.swarmforge/operator/status.json" "[:babysitterd_watchdog :state]")" == disabled ]]'
check "05: disabled never restarts" 'never_restarted "$F5"'
check "05: disabled writes no alert" \
  '[[ "$(jget "$F5/.swarmforge/operator/babysitterd-watchdog.json" ":last_alert_at_ms")" == nil ]]'

# ── 06: OPERATOR_BABYSITTERD_WATCHDOG_ENABLED=0 → disabled ────────────────
F6="$(make_fixture)"
tick "$F6" env OPERATOR_BABYSITTERD_WATCHDOG_ENABLED=0 >/dev/null
check "06: env disable publishes disabled" \
  '[[ "$(jget_in "$F6/.swarmforge/operator/status.json" "[:babysitterd_watchdog :state]")" == disabled ]]'
check "06: env disable never restarts" 'never_restarted "$F6"'

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime babysitterd-watchdog: ALL CHECKS PASSED"
else
  echo "operator_runtime babysitterd-watchdog: FAILURES ABOVE"
  exit 1
fi
