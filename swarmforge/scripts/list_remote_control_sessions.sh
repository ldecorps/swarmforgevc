#!/usr/bin/env bash
# Show claude.ai/code remote-control session URLs captured from agent panes.
#
# Usage: list_remote_control_sessions.sh [project-root]
#
# Remote Control only appears in the Claude app when the agent was launched
# with --remote-control <name>. Each named session (SwarmForge-QA, etc.) is
# listed separately in claude.ai/code — not as a single "swarm" entry.

set -euo pipefail

ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
ROLES_FILE="$ROOT/.swarmforge/roles.tsv"
SOCKET_FILE="$ROOT/.swarmforge/tmux-socket"

if [[ ! -f "$ROLES_FILE" ]]; then
  echo "No swarm roles at $ROLES_FILE" >&2
  exit 1
fi

if [[ ! -f "$SOCKET_FILE" ]]; then
  echo "No tmux socket — swarm not running?" >&2
  exit 1
fi

SOCK="$(<"$SOCKET_FILE")"
PATTERN='https://claude\.ai/code/session_[A-Za-z0-9_-]+'

printf 'Remote Control sessions (from tmux pane scrollback)\n'
printf 'Project: %s\n\n' "$ROOT"

found=0
while IFS=$'\t' read -r role _ _ session _ _ _ _; do
  [[ -z "$role" ]] && continue
  pane="$(tmux -S "$SOCK" capture-pane -p -t "$session" -S -500 2>/dev/null || true)"
  url="$(printf '%s' "$pane" | grep -Eo "$PATTERN" | tail -1 || true)"
  rc_name=""
  case "$role" in
    QA) rc_name="SwarmForge-QA" ;;
    *) rc_name="SwarmForge-$(echo "$role" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')" ;;
  esac
  launch="$ROOT/.swarmforge/launch/${role}.sh"
  has_flag=""
  if [[ -f "$launch" ]] && grep -q -- '--remote-control' "$launch"; then
    has_flag="yes"
  else
    has_flag="NO — respawn or relaunch swarm"
  fi

  if [[ -n "$url" ]]; then
    printf '%-14s %-28s %s\n' "$role" "$rc_name" "$url"
    found=$((found + 1))
  else
    printf '%-14s %-28s (no URL in pane — launch script RC: %s)\n' "$role" "$rc_name" "$has_flag"
  fi
done < "$ROLES_FILE"

printf '\n'
if [[ "$found" -eq 0 ]]; then
  cat <<'EOF'
No remote-control URLs found in pane history.

Common causes:
  1. Agents started before --remote-control was added to launch scripts.
     Fix: relaunch or `./swarm ensure <path>` to respawn panes from updated scripts.
  2. URL printed at session start then scrolled away — respawn once to re-print.
  3. Remote Control not enabled in Claude account / mobile app not signed in.
  4. In claude.ai/code, look for named sessions (SwarmForge-QA), not the Cursor chat.

EOF
fi
