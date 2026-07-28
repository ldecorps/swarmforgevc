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
# BL-657: functions are defined unconditionally below so this file can be
# `source`d by tests without running the real launch (mirrors swarmforge.sh's
# own sourced-vs-executed split) - only the block guarded by the
# BASH_SOURCE/$0 check at the bottom actually parses args and launches.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START_ANCILLARY="$SCRIPT_DIR/swarmforge/scripts/start_ancillary_services.sh"

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

# BL-657: the failing case observed sessions alive at t+2s, tmux SERVER gone
# at t+3s - a single-snapshot readiness check can land inside that narrow
# alive window and falsely declare success right before the death. Requiring
# the session count to stay >= want across WAIT_FOR_READY_CONFIRMATIONS
# consecutive polls (default 2, i.e. one full poll interval of sustained
# liveness) before declaring victory closes that race: a poll landing during
# the alive window no longer short-circuits the loop, so the NEXT poll
# (after the death) resets the confirmation count and the loop correctly
# runs out and reports failure with diagnostics instead of a false "up".
wait_for_ready() {
  local want="$1" i sock n confirm=0
  local confirm_needed="${WAIT_FOR_READY_CONFIRMATIONS:-2}"
  local poll_interval="${WAIT_FOR_READY_POLL_INTERVAL:-2}"
  local max_polls="${WAIT_FOR_READY_MAX_POLLS:-60}"
  for ((i = 0; i < max_polls; i++)); do
    if sock="$(read_socket)" && n="$(tmux -S "$sock" list-sessions 2>/dev/null | grep -c . || true)" && [[ "${n:-0}" -ge "$want" && "$want" -gt 0 ]]; then
      confirm=$((confirm + 1))
      if [[ "$confirm" -ge "$confirm_needed" ]]; then
        echo "SwarmForge agents are up: $n session(s) on $sock (confirmed stable across $confirm_needed check(s))"
        tmux -S "$sock" list-sessions 2>/dev/null || true
        return 0
      fi
    else
      confirm=0
    fi
    sleep "$poll_interval"
  done
  echo "ERROR: swarm did not become ready (wanted $want sessions)" >&2
  capture_launch_failure_diagnostics "$want"
  return 1
}

# BL-657: a bare "did not become ready" left the operator doing ad-hoc
# forensics from scratch every occurrence. Capture what's actually knowable
# at the moment of failure - whether the socket/server still exist, the
# last sessions seen, and the tail of the launch log - so a future failure
# leaves a readable cause instead of only the one-line error.
capture_launch_failure_diagnostics() {
  local want="$1" sock
  echo "--- launch failure diagnostics (BL-657) ---" >&2
  if sock="$(read_socket)"; then
    echo "socket file recorded: $sock" >&2
    if [[ -S "$sock" ]]; then
      echo "socket file exists on disk" >&2
    else
      echo "socket file does NOT exist on disk (server never bound it, or it was removed)" >&2
    fi
    if tmux -S "$sock" list-sessions >/dev/null 2>&1; then
      echo "tmux server on $sock still responds; sessions:" >&2
      tmux -S "$sock" list-sessions 2>&1 >&2 || true
    else
      echo "tmux server on $sock is NOT responding (wanted $want sessions) - the server likely died after launch" >&2
    fi
  else
    echo "no socket file recorded at $SOCKET_FILE - the launcher never got far enough to write one" >&2
  fi
  local log="$TARGET/.swarmforge/start-swarm-launch.log"
  if [[ -f "$log" ]]; then
    echo "last 20 lines of $log:" >&2
    tail -n 20 "$log" >&2 || true
  else
    echo "no launch log found at $log" >&2
  fi
}

# BL-372/BL-657: this proves our OWN nohup'd launch job won't die when the
# calling shell exits - it does NOT prove the tmux server it goes on to
# start will stay up (tmux's server self-daemonizes and ignores SIGHUP for
# its own unrelated reasons, so it can never be checked this way - see
# swarm_detach_lib.bb's header). wait_for_ready's sustained check is what
# catches a server that comes up and then dies; this check alone must never
# be read as "the swarm will survive".
check_detached() {
  local pid="$1"
  bb "$SCRIPT_DIR/swarmforge/scripts/check_swarm_detached.bb" 1 "$pid"
}

main() {
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

Usage:
  ./start-swarm.sh [options] [target-path]   # defaults to this repo's root

Options:
  -clean, --clean   Hard-reset every role worktree onto main (git reset
                    --hard + git clean -fd) before launching.

Provider packs: use ./start-swarm-qwen.sh, ./start-swarm-gpt.sh, etc.
Skip ancillaries: SWARMFORGE_SKIP_OPERATOR=1 SWARMFORGE_SKIP_BABYSITTER=1 ...
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

  echo "Target: $TARGET"
  stop_existing

  if [[ "$CLEAN" -eq 1 ]]; then
    align_worktrees_to_main
  fi

  PACK="$(resolve_launch_pack)"
  WANT="$(expected_session_count)"
  echo "Launching headless swarm (pack=${PACK:-default}, expecting $WANT sessions) ..."
  mkdir -p "$TARGET/.swarmforge"

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
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
