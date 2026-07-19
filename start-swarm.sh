#!/usr/bin/env bash
#
# start-swarm.sh — reliably (re)start the SwarmForge swarm headless.
#
# The bare `./swarm` uses a terminal backend (Terminal.app / ghostty) that can
# fail when launched outside an interactive shell (e.g. from the VS Code
# extension host, which also may not have tmux/bb/claude on its PATH). This
# wrapper forces headless mode, makes sure common tool paths are present,
# cleanly stops any swarm already on the socket, then starts and waits until
# every configured role session is up.
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
start-swarm.sh — reliably (re)start the SwarmForge swarm headless.

Usage:
  ./start-swarm.sh [options] [target-path]   # defaults to this repo's root

Options:
  -clean, --clean   Hard-reset every role worktree onto main (git reset
                    --hard + git clean -fd) before launching.
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

# GUI-launched processes (VS Code) often miss Homebrew paths where tmux/bb/claude live.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

for tool in tmux; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: required tool '$tool' not found on PATH ($PATH)" >&2
    exit 1
  fi
done

SOCKET_FILE="$TARGET/.swarmforge/tmux-socket"
DAEMON_PID_FILE="$TARGET/.swarmforge/daemon/handoffd.pid"

read_socket() {
  # Prints the tmux socket path from $SOCKET_FILE and returns 0 if it exists
  # and is non-empty; returns 1 (nothing printed) otherwise. Shared by every
  # caller that needs to resolve the current socket.
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
  # Prefer explicit env, then last-launched pack from swarm-identity, then
  # perplexity-mono-router when present (current primary pack).
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
  # Mono-router / sequential rotation: resident + coordinator only (2).
  # Otherwise: one session per window line (+ coordinator is auto-added, but
  # window lines already exclude coordinator in packs).
  local conf
  conf="$(resolve_launch_conf)"
  if [[ -f "$conf" ]] && grep -qE '^[[:space:]]*config[[:space:]]+rotation[[:space:]]+(router|sequential)[[:space:]]*$' "$conf"; then
    echo 2
    return
  fi
  if [[ -f "$conf" ]]; then
    # window lines + auto-provisioned coordinator
    local windows
    windows="$(grep -cE '^[[:space:]]*window[[:space:]]' "$conf" 2>/dev/null || echo 0)"
    echo $((windows + 1))
  else
    local roles_file="$TARGET/.swarmforge/roles.tsv"
    [[ -f "$roles_file" ]] && grep -cve '^[[:space:]]*$' "$roles_file" || echo 0
  fi
}

wait_for_ready() {
  local want="$1" i sock n
  for ((i = 0; i < 60; i++)); do
    if sock="$(read_socket)"; then
      n="$(tmux -S "$sock" list-sessions 2>/dev/null | grep -c . || true)"
      if [[ "${n:-0}" -ge "$want" && "$want" -gt 0 ]]; then
        echo "SwarmForge is up: $n session(s) on $sock"
        tmux -S "$sock" list-sessions 2>/dev/null || true
        return 0
      fi
    fi
    sleep 2
  done
  echo "ERROR: swarm did not become ready (wanted $want sessions)" >&2
  return 1
}

check_detached() {
  # BL-372: ASSERT the launch job we just backgrounded actually detached
  # from us (this script) - never a silent pass. Checked against OUR OWN
  # launch job's pid, right after backgrounding it (LAUNCH_PID, still
  # captured below), not against the eventual tmux server: an architect
  # review (2026-07-14) reproduced, twice, that a real tmux server's own
  # process always self-daemonizes (reparented, SIGHUP already ignored)
  # regardless of whether the launcher used nohup - checking the SERVER
  # can never discriminate a working fix from a broken one. Checking OUR
  # OWN launch job's SIGHUP disposition (nohup's own direct, immediate
  # effect) does. Decision logic lives in swarm_detach_lib.bb (pure,
  # unit-tested); this is I/O wiring only.
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
# BL-372: detach the launch from this wrapper's own session/process group -
# the same portable nohup ... & idiom start_handoff_daemon.sh already uses
# for handoffd - so a swarm launched from a short-lived caller (a
# disposable Operator window) survives however that caller goes away
# (exiting, its window being killed, a hangup signal), instead of dying
# with it. wait_for_ready below is unaffected: it polls the socket/session
# state directly, never the launch subprocess's own exit.
LAUNCH_ARGS=("$TARGET")
if [[ -n "$PACK" ]]; then
  LAUNCH_ARGS+=(--pack "$PACK")
fi
nohup env SWARMFORGE_TERMINAL=none "$TARGET/swarm" "${LAUNCH_ARGS[@]}" >> "$TARGET/.swarmforge/start-swarm-launch.log" 2>&1 &
LAUNCH_PID=$!
disown

# Checked right away, not after wait_for_ready: nohup's effect (SIGHUP set
# to ignored) takes hold before the wrapped command even execs, so there is
# no race to wait out - and the launch job may well have already exited
# (normally - it just finishes provisioning and returns) by the time
# wait_for_ready succeeds, at which point its own state is no longer
# checkable at all.
if ! check_detached "$LAUNCH_PID"; then
  echo "ERROR: swarm launch is still owned by the caller - it will die when this shell exits" >&2
  exit 1
fi

if ! wait_for_ready "$WANT"; then
  exit 1
fi
