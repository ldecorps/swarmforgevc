#!/usr/bin/env bash
#
# start-swarm.sh — reliably (re)start the full SwarmForge stack headless.
#
# The bare `./swarm` uses a terminal backend (Terminal.app / ghostty) that can
# fail when launched outside an interactive shell (e.g. from the VS Code
# extension host, which also may not have tmux/bb/claude on its PATH). This
# wrapper forces headless mode, makes sure common tool paths are present,
# cleanly stops any swarm already on the socket, launches agents, then brings
# up operator / Telegram front desk / babysitter / tunnels and runs ensure.
#
# Usage:
#   ./start-swarm.sh [options] [target-path]   # defaults to this repo's root
#
# Options:
#   -clean, --clean   After stopping any live swarm, hard-reset every role
#                     worktree (and its agent branch tip) onto main, then
#                     git clean -fd, so all roles start aligned with main.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START_ANCILLARY="$SCRIPT_DIR/swarmforge/scripts/start_ancillary_services.sh"
# BL-657: strip Claude Code / Cursor harness markers before any tmux server
# can inherit them from this shell (or from the nohup'd ./swarm child).
# shellcheck disable=SC1091
source "$SCRIPT_DIR/swarmforge/scripts/harness_env_scrub.sh"
scrub_harness_env
# shellcheck disable=SC1091
source "$SCRIPT_DIR/swarmforge/scripts/availability_ledger_lib.sh"

CLEAN=0
TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -clean|--clean)
      CLEAN=1
      shift
      ;;
    -h|--help)
      cat <<'EOF'
start-swarm.sh — reliably (re)start the full SwarmForge stack headless.

Scope: full stack
Starts: pipeline agents + handoffd, then ancillaries (operator runtime,
        Telegram front desk, babysitterd, onboarder, tunnels).

Stop: ./stop-swarm.sh (full stack). Pipeline-only stop: ./swarm-kill.

Usage:
  ./start-swarm.sh [options] [target-path]   # defaults to this repo's root

Options:
  -clean, --clean   Hard-reset every role worktree onto main (git reset
                    --hard + git clean -fd) before launching.

Provider packs: use ./start-swarm-qwen.sh, ./start-swarm-gpt.sh, etc.
Skip ancillaries: SWARMFORGE_SKIP_OPERATOR=1 SWARMFORGE_SKIP_BABYSITTERD=1 ...
EOF
      exit 0
      ;;
    -*)
      echo "ERROR: unknown option: $1" >&2
      echo "Usage: ./start-swarm.sh [-clean|--clean] [target-path]" >&2
      exit 2
      ;;
    *)
      if [[ -n "$TARGET" ]]; then
        echo "ERROR: unexpected extra argument: $1" >&2
        exit 2
      fi
      TARGET="$1"
      shift
      ;;
  esac
done

TARGET="${TARGET:-$SCRIPT_DIR}"
TARGET="$(cd "$TARGET" && pwd)"

if [[ -f "$TARGET/.swarmforge/swarm.env" ]]; then
  # shellcheck disable=SC1090
  source "$TARGET/.swarmforge/swarm.env"
fi

# shellcheck disable=SC1090
source "$HOME/.zshenv" 2>/dev/null || true
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

for tool in tmux bb; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: required tool '$tool' not found on PATH ($PATH)" >&2
    exit 1
  fi
done

SOCKET_FILE="$TARGET/.swarmforge/tmux-socket"
DAEMON_PID_FILE="$TARGET/.swarmforge/daemon/handoffd.pid"

read_socket() {
  [[ -f "$SOCKET_FILE" ]] || return 1
  local s
  s="$(cat "$SOCKET_FILE" 2>/dev/null || true)"
  [[ -n "$s" ]] || return 1
  printf '%s\n' "$s"
}

stop_existing() {
  local sock
  sock="$(read_socket)" || return 0

  local sessions
  sessions="$(tmux -S "$sock" list-sessions -F '#{session_name}' 2>/dev/null || true)"
  if [[ -n "$sessions" ]]; then
    echo "Stopping running swarm on $sock ..."
    while IFS= read -r s; do
      [[ -n "$s" ]] && tmux -S "$sock" kill-session -t "$s" 2>/dev/null || true
    done <<< "$sessions"
  fi

  if [[ -f "$DAEMON_PID_FILE" ]]; then
    local pid
    pid="$(cat "$DAEMON_PID_FILE" 2>/dev/null || true)"
    [[ "$pid" =~ ^[0-9]+$ ]] && kill -TERM "$pid" 2>/dev/null || true
  fi
  sleep 1
}

align_worktrees_to_main() {
  echo "Cleaning role worktrees onto main (-clean) ..."
  bash "$SCRIPT_DIR/swarmforge/scripts/reset_worktrees.sh" --align-main "$TARGET"
}

resolve_launch_pack() {
  if [[ -n "${SWARMFORGE_PACK:-}" ]]; then
    printf '%s\n' "$SWARMFORGE_PACK"
    return
  fi
  if [[ -n "${SWARMFORGE_CONFIG:-}" ]]; then
    local base
    base="$(basename "$SWARMFORGE_CONFIG" .conf)"
    printf '%s\n' "$base"
    return
  fi
  local identity="$TARGET/.swarmforge/swarm-identity"
  if [[ -f "$identity" ]]; then
    local launch_pack
    launch_pack="$(awk -F'\t' '$1=="launch_pack"{print $2; exit}' "$identity")"
    if [[ -n "$launch_pack" ]]; then
      printf '%s\n' "$launch_pack"
      return
    fi
    local conf_path
    conf_path="$(awk -F'\t' '$1=="active_backlog_max_depth_conf_path"{print $2; exit}' "$identity")"
    if [[ -n "$conf_path" && -f "$conf_path" ]]; then
      basename "$conf_path" .conf
      return
    fi
  fi
  if [[ -f "$TARGET/swarmforge/packs/perplexity-mono-router.conf" ]]; then
    echo "perplexity-mono-router"
    return
  fi
  echo ""
}

resolve_launch_conf() {
  local pack
  pack="$(resolve_launch_pack)"
  if [[ -n "$pack" && -f "$TARGET/swarmforge/packs/${pack}.conf" ]]; then
    printf '%s\n' "$TARGET/swarmforge/packs/${pack}.conf"
  else
    printf '%s\n' "$TARGET/swarmforge/swarmforge.conf"
  fi
}

expected_session_count() {
  local conf
  conf="$(resolve_launch_conf)"
  if [[ -f "$conf" ]] && grep -qE '^[[:space:]]*config[[:space:]]+rotation[[:space:]]+(router|sequential)[[:space:]]*$' "$conf"; then
    echo 2
    return
  fi
  if [[ -f "$conf" ]]; then
    local windows
    windows="$(grep -cE '^[[:space:]]*window[[:space:]]' "$conf" 2>/dev/null || echo 0)"
    echo $((windows + 1))
  else
    local roles_file="$TARGET/.swarmforge/roles.tsv"
    [[ -f "$roles_file" ]] && grep -cve '^[[:space:]]*$' "$roles_file" || echo 0
  fi
}

report_ready_failure() {
  local want="$1"
  local diag="$TARGET/.swarmforge/start-swarm-fail-diag.txt"
  mkdir -p "$TARGET/.swarmforge"
  {
    echo "=== BL-657 launch failure diagnosis $(date -u +%Y-%m-%dT%H:%MZ) ==="
    echo "wanted_sessions=$want"
    echo "target=$TARGET"
    if sock="$(read_socket)"; then
      echo "socket=$sock"
      echo "--- tmux list-sessions ---"
      tmux -S "$sock" list-sessions 2>&1 || echo "(list-sessions failed — server likely dead)"
      echo "--- tmux server pid ---"
      tmux -S "$sock" display-message -p '#{pid}' 2>&1 || echo "(no responding server)"
      echo "--- global env (harness markers) ---"
      tmux -S "$sock" show-environment -g 2>&1 | grep -E 'CLAUDE_CODE_|CLAUDECODE|CURSOR_' || echo "(none or server gone)"
    else
      echo "socket file missing or empty at $SOCKET_FILE"
    fi
    echo "--- tail start-swarm-launch.log ---"
    if [[ -f "$TARGET/.swarmforge/start-swarm-launch.log" ]]; then
      tail -n 80 "$TARGET/.swarmforge/start-swarm-launch.log" 2>&1 || true
    else
      echo "(no start-swarm-launch.log)"
    fi
    echo "=== end diagnosis; full copy: $diag ==="
  } | tee "$diag" >&2
  echo "ERROR: swarm did not become ready (wanted $want sessions); diagnosis: $diag" >&2
}

wait_for_ready() {
  # BL-657: sessions can appear then vanish in 1–3s when a harness-poisoned
  # tmux server dies. Require a second sighting after the failure window.
  local want="$1" i sock n
  local seen_once=0
  for ((i = 0; i < 60; i++)); do
    if sock="$(read_socket)"; then
      scrub_tmux_harness_env "$sock"
      n="$(tmux -S "$sock" list-sessions 2>/dev/null | grep -c . || true)"
      if [[ "${n:-0}" -ge "$want" && "$want" -gt 0 ]]; then
        if [[ "$seen_once" -eq 0 ]]; then
          seen_once=1
          echo "Sessions visible ($n) — waiting past the BL-657 failure window ..."
          sleep 5
          continue
        fi
        n="$(tmux -S "$sock" list-sessions 2>/dev/null | grep -c . || true)"
        if [[ "${n:-0}" -ge "$want" ]]; then
          echo "SwarmForge agents are up: $n session(s) on $sock"
          tmux -S "$sock" list-sessions 2>/dev/null || true
          return 0
        fi
        seen_once=0
        echo "Sessions vanished after first sighting — continuing to wait ..."
      fi
    fi
    sleep 2
  done
  report_ready_failure "$want"
  return 1
}

check_detached() {
  local pid="$1"
  bb "$SCRIPT_DIR/swarmforge/scripts/check_swarm_detached.bb" 1 "$pid"
}

echo "Target: $TARGET"
stop_existing

if [[ "$CLEAN" -eq 1 ]]; then
  align_worktrees_to_main
fi

PACK="$(resolve_launch_pack)"
WANT="$(expected_session_count)"
echo "Launching headless swarm (pack=${PACK:-default}, expecting $WANT sessions) ..."
mkdir -p "$TARGET/.swarmforge"

# BL-823: the start record closes the stop interval and triggers the
# heartbeat-inferred close. stop_existing above may have torn down a live
# swarm without going through kill_pipeline_swarm.sh's own "stop" record
# (an ungraceful stop from the ledger's perspective) - close-ungraceful-stop
# runs FIRST, against the ledger's prior state, before this start is
# recorded.
availability_close_ungraceful_stop "$TARGET" "$TARGET/.swarmforge/daemon/handoffd.heartbeat"
availability_record "$TARGET" "start" "swarm-stop" "start-swarm.sh"

LAUNCH_ARGS=("$TARGET")
if [[ -n "$PACK" ]]; then
  LAUNCH_ARGS+=(--pack "$PACK")
fi
nohup env SWARMFORGE_TERMINAL=none "$TARGET/swarm" "${LAUNCH_ARGS[@]}" >> "$TARGET/.swarmforge/start-swarm-launch.log" 2>&1 &
LAUNCH_PID=$!
disown

if ! check_detached "$LAUNCH_PID"; then
  echo "ERROR: swarm launch is still owned by the caller - it will die when this shell exits" >&2
  exit 1
fi

if ! wait_for_ready "$WANT"; then
  exit 1
fi

echo "Starting ancillaries (operator, front desk, babysitter, tunnels) ..."
bash "$START_ANCILLARY" "$TARGET"

echo "Running ./swarm ensure ..."
touch "$TARGET/.swarmforge/headless-swarm"
if ! "$TARGET/swarm" ensure "$TARGET"; then
  echo "WARN: ./swarm ensure reported failures — check output above." >&2
fi

echo ""
echo "Full stack launch complete. Status:"
"$TARGET/swarm" status "$TARGET" 2>/dev/null || true
