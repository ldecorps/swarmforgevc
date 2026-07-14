#!/usr/bin/env bash
# Attach to a live SwarmForge tmux session using the project socket.
#
# Usage:
#   swarm_attach.sh [role] [project-root]
#   swarm_attach.sh [project-root]          # role defaults to coordinator
#   swarm_attach.sh                         # coordinator in cwd / git root
#
# Roles may be bare (coordinator), display names (Coordinator), or full session
# names (swarmforge-coordinator). With no role and multiple sessions, lists them.
#
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: attach-swarm [role] [project-root]

Attach to a running SwarmForge agent in tmux.

Examples:
  attach-swarm                         # coordinator in current project
  attach-swarm coder                   # coder pane
  attach-swarm cleaner .               # cleaner in cwd
  attach-swarm /path/to/target         # coordinator in that repo

Detach from tmux with: Ctrl-b d
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

resolve_root() {
  local candidate="${1:-}"
  if [[ -n "$candidate" && -d "$candidate" ]]; then
    (cd "$candidate" && pwd)
    return
  fi
  if git rev-parse --show-toplevel >/dev/null 2>&1; then
    git rev-parse --show-toplevel
    return
  fi
  pwd
}

looks_like_path() {
  [[ -n "${1:-}" && ( "$1" == . || "$1" == .. || "$1" == /* || -d "$1" ) ]]
}

ROLE=""
TARGET=""

case $# in
  0)
    TARGET="$(resolve_root "")"
    ROLE="coordinator"
    ;;
  1)
    if looks_like_path "$1"; then
      TARGET="$(resolve_root "$1")"
      ROLE="coordinator"
    else
      TARGET="$(resolve_root "")"
      ROLE="$1"
    fi
    ;;
  *)
    ROLE="$1"
    TARGET="$(resolve_root "$2")"
    ;;
esac

ROLES_FILE="$TARGET/.swarmforge/roles.tsv"
SOCKET_FILE="$TARGET/.swarmforge/tmux-socket"

if [[ ! -f "$SOCKET_FILE" ]]; then
  echo "No swarm socket at $SOCKET_FILE — is the swarm running?" >&2
  echo "Start one with: SWARMFORGE_TERMINAL=none ./swarm $TARGET" >&2
  exit 1
fi

SOCK="$(<"$SOCKET_FILE")"
if [[ -z "$SOCK" ]]; then
  echo "Empty tmux socket file: $SOCKET_FILE" >&2
  exit 1
fi

if ! tmux -S "$SOCK" info >/dev/null 2>&1; then
  echo "Tmux socket not live: $SOCK" >&2
  echo "Stale socket file? Relaunch the swarm or remove $SOCKET_FILE" >&2
  exit 1
fi

normalize_role() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/^swarmforge-//'
}

resolve_session() {
  local want
  want="$(normalize_role "$1")"

  if [[ -f "$ROLES_FILE" ]]; then
    while IFS=$'\t' read -r role _ _ session display _ _ _ _; do
      [[ -z "$role" ]] && continue
      if [[ "$(printf '%s' "$role" | tr '[:upper:]' '[:lower:]')" == "$want" \
         || "$(printf '%s' "$display" | tr '[:upper:]' '[:lower:]')" == "$want" \
         || "$session" == "$1" \
         || "$session" == "swarmforge-$want" ]]; then
        echo "$session"
        return 0
      fi
    done < "$ROLES_FILE"
  fi

  if tmux -S "$SOCK" has-session -t "swarmforge-$want" 2>/dev/null; then
    echo "swarmforge-$want"
    return 0
  fi

  return 1
}

list_sessions() {
  echo "Live sessions on $SOCK:" >&2
  tmux -S "$SOCK" list-sessions -F '  #{session_name}' 2>/dev/null || true
  if [[ -f "$ROLES_FILE" ]]; then
    echo "Configured roles:" >&2
    while IFS=$'\t' read -r role _ _ session display _ _ _ _; do
      [[ -z "$role" ]] && continue
      printf '  %-14s (%s)\n' "$role" "$session" >&2
    done < "$ROLES_FILE"
  fi
}

SESSION=""
if [[ -n "$ROLE" ]]; then
  SESSION="$(resolve_session "$ROLE" || true)"
fi

if [[ -z "$SESSION" ]]; then
  echo "Unknown role: $ROLE" >&2
  list_sessions
  exit 1
fi

if ! tmux -S "$SOCK" has-session -t "$SESSION" 2>/dev/null; then
  echo "Session not running: $SESSION" >&2
  list_sessions
  exit 1
fi

echo "Attaching to $SESSION (project: $TARGET)" >&2
echo "Detach with Ctrl-b d" >&2
exec tmux -S "$SOCK" attach-session -t "$SESSION"
