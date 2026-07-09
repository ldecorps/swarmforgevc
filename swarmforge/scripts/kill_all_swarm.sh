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
SOCKET_GLOB="/tmp/swarmforge-"*/*.sock

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

# 2. Every swarmforge tmux socket (stale Jul-8 orphans, etc.).
for sock in $SOCKET_GLOB; do
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
