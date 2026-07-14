#!/usr/bin/env bash
# Nuclear stop: tmux agents, handoffd, stale sockets, SwarmForge copilot
# processes, and swarm state markers. Idempotent — safe when nothing is running.
#
# Usage:
#   kill_all_swarm.sh [repo-root]
#   kill_all_swarm.sh --sweep-inbox [repo-root]
#   kill_all_swarm.sh --reset-worktrees [repo-root]
#   kill_all_swarm.sh --full [repo-root]   # inbox sweep + worktree reset
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SWEEP_INBOX=0
RESET_WORKTREES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sweep-inbox)
      SWEEP_INBOX=1
      shift
      ;;
    --reset-worktrees)
      RESET_WORKTREES=1
      shift
      ;;
    --full)
      SWEEP_INBOX=1
      RESET_WORKTREES=1
      shift
      ;;
    -h|--help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      break
      ;;
  esac
done

ROOT="$(cd "${1:-.}" && pwd)"
DAEMON_DIR="$ROOT/.swarmforge/daemon"
AUDIT="$DAEMON_DIR/kill-all-audit.log"
# BL-367: the control socket now lives under the target root's own
# .swarmforge/tmux/ (never /tmp) - scoped to $ROOT by construction, so a
# fixture root used by a test can never match another project's (or the
# live swarm's) socket. The old /tmp/swarmforge-<uid>/<hash>.sock path is
# still checked, but as a SINGLE exact match (the same cksum
# PROJECT_SOCKET_ID swarmforge.sh computes for this root) - never a broad
# glob across the whole /tmp/swarmforge-<uid>/ directory, which would match
# every OTHER project's socket for this uid too. (Postmortem: an earlier,
# unscoped version of this legacy glob, exercised by an isolated test
# fixture, matched and killed the live swarm's real socket 5 times in one
# session - see swarmforge/scripts/test/test_swarm_socket_not_in_tmp.sh.)
source "$SCRIPT_DIR/project_socket_id_lib.sh"
SOCKET_GLOB="$ROOT/.swarmforge/tmux/"*.sock
LEGACY_PROJECT_SOCKET_ID="$(project_socket_id "$ROOT")"
LEGACY_SOCKET="/tmp/swarmforge-${UID}/${LEGACY_PROJECT_SOCKET_ID}.sock"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$AUDIT"
}

signal_pid_file() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 0
  local pid
  pid="$(< "$pid_file")"
  if [[ "$pid" =~ ^[0-9]+$ ]]; then
    kill -TERM "$pid" 2>/dev/null || true
    sleep 0.2
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}

kill_tmux_socket() {
  local sock="$1"
  [[ -S "$sock" ]] || return 0
  log "tmux kill-server $sock"
  tmux -S "$sock" kill-server 2>/dev/null || true
}

mkdir -p "$DAEMON_DIR"
log "kill_all_swarm begin root=$ROOT sweep_inbox=$SWEEP_INBOX reset_worktrees=$RESET_WORKTREES"

# 0. Graceful agent shutdown FIRST. `tmux kill-server` below sends SIGHUP, which
# kills each role's `claude` before it can deregister its --remote-control
# session on the claude.ai backend, leaving ghost entries in the app (a stale
# "SwarmForge-Coder" alongside the live one on every restart). SIGTERM the agent
# processes for THIS root and give them a moment to clean up, then let the tmux
# teardown reap whatever remains.
graceful_stop_agents() {
  local pids
  pids="$(pgrep -f "claude .*$ROOT/.swarmforge/launch/" 2>/dev/null || true)"
  [[ -n "$pids" ]] || { log "no agent processes to stop gracefully"; return 0; }
  log "SIGTERM agents: $(printf '%s ' $pids)"
  # shellcheck disable=SC2086
  kill -TERM $pids 2>/dev/null || true
  # Wait up to ~3s for graceful deregistration + exit.
  for _ in 1 2 3 4 5 6; do
    pids="$(pgrep -f "claude .*$ROOT/.swarmforge/launch/" 2>/dev/null || true)"
    [[ -n "$pids" ]] || break
    sleep 0.5
  done
}
graceful_stop_agents

# 1. Per-role sessions on the tracked socket (best-effort before kill-server).
if [[ -f "$ROOT/.swarmforge/tmux-socket" ]]; then
  tracked="$(< "$ROOT/.swarmforge/tmux-socket")"
  if [[ -S "$tracked" && -f "$ROOT/.swarmforge/roles.tsv" ]]; then
    while IFS=$'\t' read -r _role _ _ session _ _ _ _; do
      [[ -n "${session:-}" ]] || continue
      tmux -S "$tracked" kill-session -t "$session" 2>/dev/null \
        && log "killed session $session" || true
    done < "$ROOT/.swarmforge/roles.tsv"
  fi
  kill_tmux_socket "$tracked"
fi

# 2. Every swarmforge tmux socket under this root's own .swarmforge/tmux/
# (stale orphans, etc.), plus this root's single exact legacy /tmp path.
for sock in $SOCKET_GLOB "$LEGACY_SOCKET"; do
  [[ -e "$sock" ]] || continue
  kill_tmux_socket "$sock"
done

# 3. handoffd + supervisor (supervisor first — same order as extension stop).
signal_pid_file "$DAEMON_DIR/handoffd-supervisor.pid"
signal_pid_file "$DAEMON_DIR/handoffd.pid"
rm -f "$DAEMON_DIR/stop"
if [[ -f "$DAEMON_DIR/handoffd.status.json" ]]; then
  if grep -q '"state":"halted"' "$DAEMON_DIR/handoffd.status.json" 2>/dev/null; then
    rm -f "$DAEMON_DIR/handoffd.status.json"
    log "cleared halted daemon status"
  fi
fi

# 4. Stray handoffd for this project root (not tracked in pid file).
while IFS= read -r line; do
  pid="${line%% *}"
  [[ "$pid" =~ ^[0-9]+$ ]] || continue
  kill -TERM "$pid" 2>/dev/null || true
  log "reaped handoffd pid=$pid"
done < <(pgrep -fl "handoffd\.bb.*$ROOT" 2>/dev/null | grep -v handoffd_supervisor || true)

# 5. SwarmForge copilot agents.
if pkill -f 'copilot.*SwarmForge' 2>/dev/null; then
  log "signaled SwarmForge copilot processes"
else
  log "no SwarmForge copilot processes"
fi

# 6. Clear swarm state markers so the next launch cannot reattach to ghosts.
rm -f "$ROOT/.swarmforge/tmux-socket" "$ROOT/.swarmforge/sessions.tsv"
log "cleared tmux-socket and sessions.tsv"

# 6.5 (BL-352): complete the run this stop just ended, in the SAME run
# history swarmforge.sh's own launch recording writes into. VS Code's own
# stopSwarm command has its own separate, direct tmux teardown (never
# calls this script), so this can never double-complete a run the VS Code
# path also completed - there is nothing to skip here, unlike the launch
# side. Best-effort: a missing/stale compiled CLI must never block a real
# stop over a history-recording concern.
RECORD_RUN_CLI="$ROOT/extension/out/tools/record-run.js"
if [[ -f "$RECORD_RUN_CLI" ]]; then
  node "$RECORD_RUN_CLI" stop "$ROOT" >/dev/null 2>&1 || true
fi

# 7. Optional inbox sweep + worktree reset.
if [[ "$SWEEP_INBOX" -eq 1 ]]; then
  log "sweep_all_inbox"
  bash "$SCRIPT_DIR/sweep_all_inbox.sh" "$ROOT" | tee -a "$AUDIT" || true
fi
if [[ "$RESET_WORKTREES" -eq 1 ]]; then
  log "reset_worktrees"
  bash "$SCRIPT_DIR/reset_worktrees.sh" "$ROOT" | tee -a "$AUDIT" || true
fi

# 8. Post-mortem snapshot for investigation.
if [[ -x "$SCRIPT_DIR/collect_daemon_postmortem.sh" ]]; then
  postmortem="$(bash "$SCRIPT_DIR/collect_daemon_postmortem.sh" "$ROOT")"
  log "postmortem $postmortem"
fi

remaining="$(pgrep -fl 'handoffd\.bb|copilot.*SwarmForge' 2>/dev/null | grep -v pgrep || true)"
if [[ -n "$remaining" ]]; then
  log "WARNING survivors remain:"
  printf '%s\n' "$remaining" | tee -a "$AUDIT"
  exit 1
fi

log "kill_all_swarm SUCCESS — clean slate"
echo "SwarmForge stopped and cleaned. Audit: $AUDIT"
