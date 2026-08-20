#!/usr/bin/env bash
# Stop operator runtime, Telegram front desk, babysitterd, and remote tunnels.
#
# Paired with start_ancillary_services.sh and stop-swarm.sh (full-stack stop).
# Idempotent — safe when nothing is running.
#
# BL-762: each component's stop logic is its own function (stop_babysitterd,
# stop_front_desk, stop_onboarder, stop_operator_runtime, stop_tunnels), and
# stop_ancillary_component dispatches a component NAME (from
# lifecycle_matrix.sh) to the matching function. finish-shift (bedtime —
# swarmforge/scripts/finish_shift_lib.sh) sources THIS file and calls only
# the subset lifecycle_matrix.sh classifies as "stop" for the finish-shift
# verb, composing from the same tested code path rather than forking a
# second teardown implementation. Run directly (not sourced), this script's
# stop_ancillary_services_main stops every component lifecycle_matrix.sh
# classifies as "stop" for the stop-swarm verb — today that is all five,
# matching this script's behavior before BL-762 byte-for-byte (log lines,
# order, and all).
#
# Usage: stop_ancillary_services.sh [repo-root]
#
# Deliberately NO unconditional `set -euo pipefail` at file scope: this file
# is dual-purpose (sourced library + standalone script), and a sourced
# library must never change the CALLING shell's options — bash options set
# by `source` persist in the caller, so an unconditional `set -e` here would
# silently make errexit active in finish_shift_lib.sh (and anything else
# that sources this file), including bare (non-if-wrapped) statements that
# were never written expecting it. `set -euo pipefail` is applied only
# inside the run-directly guard at the bottom, matching this script's own
# actual safety needs without leaking into anyone who merely sources it for
# its functions.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/freshness_stop_marker_lib.sh"
source "$SCRIPT_DIR/lifecycle_matrix.sh"
source "$SCRIPT_DIR/tunnel_ownership_lib.sh"

# Sets the globals every stop_* function below reads: ROOT, OP_DIR, BB_DIR,
# LEGACY_BB_DIR. Callers that source this file (finish_shift_lib.sh) must
# call this once before calling any stop_* function; running this script
# directly calls it via stop_ancillary_services_main.
stop_ancillary_init() {
  ROOT="$(cd "${1:-.}" && pwd)"
  OP_DIR="$ROOT/.swarmforge/operator"
  BB_DIR="$ROOT/.swarmforge/babysitterd"
  LEGACY_BB_DIR="$ROOT/.swarmforge/babysitter"
}

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

signal_pid_file() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 0
  local pid
  pid="$(tr -d '[:space:]' < "$pid_file" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]]; then
    kill -TERM "$pid" 2>/dev/null || true
    sleep 0.3
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}

signal_pid() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  kill -TERM "$pid" 2>/dev/null || true
  sleep 0.2
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
}

stop_front_desk_children() {
  local status_file="$OP_DIR/front-desk-supervisor.status.json"
  [[ -f "$status_file" ]] || return 0
  if command -v jq >/dev/null 2>&1; then
    for key in bridge bot; do
      local pid
      pid="$(jq -r ".${key}.pid // empty" "$status_file" 2>/dev/null || true)"
      [[ -n "$pid" && "$pid" != "null" ]] && signal_pid "$pid"
    done
  else
    while IFS= read -r pid; do
      signal_pid "$pid"
    done < <(grep -oE '"pid"[[:space:]]*:[[:space:]]*[0-9]+' "$status_file" 2>/dev/null \
      | grep -oE '[0-9]+$' || true)
  fi
  # Orphans: node bridge/bot entrypoints for this project root.
  while IFS= read -r line; do
    local pid="${line%% *}"
    signal_pid "$pid"
  done < <(pgrep -fl "start-bridge-headless.js.*$ROOT" 2>/dev/null || true)
  while IFS= read -r line; do
    local pid="${line%% *}"
    signal_pid "$pid"
  done < <(pgrep -fl "telegram-front-desk-bot.js.*$ROOT" 2>/dev/null || true)
}

# babysitterd (BL-611) — signal its pidfile like the other daemons.
stop_babysitterd() {
  log "stopping babysitterd"
  signal_pid_file "$BB_DIR/babysitterd.pid"
  # BL-785: record that babysitterd was stopped ON PURPOSE, so the BL-675
  # freshness cron does not resurrect it.
  freshness_mark_stopped "$ROOT" "babysitterd"

  # Legacy LLM hawk cleanup (retired — BL-611: the babysitter is now ONLY the
  # deterministic daemon above). Best-effort teardown of any leftover
  # process/socket from before this ticket shipped; babysitterd never reads
  # this directory, so this is migration hygiene only, not part of its
  # lifecycle.
  if [[ -d "$LEGACY_BB_DIR" ]]; then
    log "clearing legacy babysitter hawk state"
    touch "$LEGACY_BB_DIR/stop" 2>/dev/null || true
    sleep 0.3
    signal_pid_file "$LEGACY_BB_DIR/runtime.pid"
    local sock="$LEGACY_BB_DIR/babysitter-tmux.sock"
    if [[ -S "$sock" ]]; then
      tmux -S "$sock" kill-server 2>/dev/null || true
      rm -f "$sock"
    fi
    rm -f "$LEGACY_BB_DIR/stop" "$LEGACY_BB_DIR/enabled" "$LEGACY_BB_DIR/socket.path" 2>/dev/null || true
  fi
}

# Front desk (graceful stop file — bridge + bot are children). This is the
# Let's Talk bridge's owner: keeping this up (bedtime) is what keeps the
# phone path reachable.
stop_front_desk() {
  log "stopping Telegram front desk"
  mkdir -p "$OP_DIR"
  touch "$OP_DIR/front-desk-supervisor.stop" 2>/dev/null || true
  sleep 1
  signal_pid_file "$OP_DIR/front-desk-supervisor.pid"
  stop_front_desk_children
  rm -f "$OP_DIR/front-desk-supervisor.status.json" \
        "$OP_DIR/front-desk-poll-heartbeat.json" 2>/dev/null || true
  rm -f "$OP_DIR/front-desk-supervisor.stop"
}

# Onboarder (graceful stop file — the reconcile poll-loop is its supervised
# child).
stop_onboarder() {
  log "stopping onboarder"
  mkdir -p "$OP_DIR"
  touch "$OP_DIR/onboarder-supervisor.stop" 2>/dev/null || true
  # BL-684 compat shim: a supervisor started before this rename may still be
  # running under the OLD name, with no one else left to stop it (the renamed
  # launcher only ever DECLINES to start beside it, never adopts it) - clear
  # both names' artifacts here for this one release. Drop once no pre-rename
  # supervisor can still be running.
  touch "$OP_DIR/onboarding-facilitator-supervisor.stop" 2>/dev/null || true
  sleep 1
  signal_pid_file "$OP_DIR/onboarder-supervisor.pid"
  signal_pid_file "$OP_DIR/onboarding-facilitator-supervisor.pid"
  rm -f "$OP_DIR/onboarder-supervisor.status.json" \
        "$OP_DIR/onboarder-heartbeat.json" \
        "$OP_DIR/onboarding-facilitator-supervisor.status.json" \
        "$OP_DIR/onboarding-facilitator-heartbeat.json" 2>/dev/null || true
  rm -f "$OP_DIR/onboarder-supervisor.stop" "$OP_DIR/onboarding-facilitator-supervisor.stop"
}

# Operator runtime (disposable Operator + supervision loop).
stop_operator_runtime() {
  log "stopping operator runtime"
  touch "$OP_DIR/stop" 2>/dev/null || true
  sleep 1
  signal_pid_file "$OP_DIR/runtime.pid"
  rm -f "$OP_DIR/stop"
}

# Remote access tunnels. Bedtime's phone-path guarantee is specifically
# about resident-spy-cloudflared (it publishes the Let's Talk bridge); the
# vscode Remote Tunnel (operator_tunnel.sh) is bundled here too, matching
# this script's pre-BL-762 behavior — bedtime keeps this whole component up
# rather than splitting it further, since only stop-swarm (lights-out) ever
# calls stop_tunnels.
stop_tunnels() {
  if [[ -f "$SCRIPT_DIR/operator_tunnel.sh" ]]; then
    log "stopping vscode tunnel"
    bash "$SCRIPT_DIR/operator_tunnel.sh" stop "$ROOT" 2>/dev/null || true
  fi
  signal_pid_file "$OP_DIR/resident-spy-cloudflared.pid"
  # Paired with launch_resident_spy_tunnel.sh ensure_tunnel_caffeinate (macOS idle).
  signal_pid_file "$OP_DIR/resident-spy-caffeinate.pid"
  reap_named_tunnel_orphans
}

# BL-857: the pidfile above is root-relative and therefore blind to any
# cloudflared bound to the production tunnel name whose launching tree (a
# property-test sandbox, most often) has since been deleted - the exact
# incident this ticket fixes. Resolves which name to scope reaping to the
# same way the launcher resolves it (env var, else THIS root's own
# named-tunnel.env); a root never configured for a named tunnel has
# nothing to reap and this is a no-op.
reap_named_tunnel_orphans() {
  local name="${SWARMFORGE_NAMED_TUNNEL:-}"
  local env_file="$OP_DIR/named-tunnel.env"
  if [[ -z "$name" && -f "$env_file" ]]; then
    name="$(sed -n 's/^SWARMFORGE_NAMED_TUNNEL=//p' "$env_file" | tail -1)"
  fi
  [[ -n "$name" ]] || return 0
  tunnel_reap_orphans "$name" "$OP_DIR/resident-spy-cloudflared.pid"
}

# Dispatches a lifecycle_matrix.sh component NAME to its stop function - the
# one mapping point both stop_ancillary_services_main (below) and
# finish_shift_lib.sh use, so a component can never be stopped by a path
# that bypasses this file's tested functions.
stop_ancillary_component() {
  case "$1" in
    babysitterd) stop_babysitterd ;;
    front-desk) stop_front_desk ;;
    onboarder) stop_onboarder ;;
    operator-runtime) stop_operator_runtime ;;
    tunnels) stop_tunnels ;;
    *)
      echo "stop_ancillary_component: ERROR — unknown component \"$1\"" >&2
      return 1
      ;;
  esac
}

stop_ancillary_services_main() {
  stop_ancillary_init "${1:-.}"
  log "stop_ancillary_services begin root=$ROOT"
  local component
  while IFS= read -r component; do
    stop_ancillary_component "$component"
  done < <(lifecycle_matrix_stop_set stop-swarm)
  log "stop_ancillary_services done"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail
  stop_ancillary_services_main "${1:-.}"
fi
