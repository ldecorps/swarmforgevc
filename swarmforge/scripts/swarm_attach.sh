#!/usr/bin/env bash
# Attach to a live SwarmForge tmux session using the project socket.
#
# Usage:
#   swarm_attach.sh [role|resident] [project-root]
#   swarm_attach.sh [project-root]          # resident (mono-router) or coordinator
#   swarm_attach.sh                         # same in cwd / git root
#
# Roles may be bare (coordinator), display names (Coordinator), full session
# names (swarmforge-coordinator), or `resident` (mono-router: reads
# .swarmforge/mono-router-active-role). With no role and multiple sessions, lists them.
#
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: attach-swarm [role] [project-root]

Attach to a running SwarmForge agent in tmux.

Examples:
  attach-swarm                         # resident (mono-router) or coordinator
  attach-swarm resident                # mono-router standing pane (recommended)
  attach-swarm coder                   # specific role (may be dormant)
  attach-swarm cleaner .               # cleaner in cwd
  attach-swarm /path/to/target         # resident/coordinator in that repo

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

read_mono_router_resident() {
  local root="$1"
  local marker="$root/.swarmforge/mono-router-active-role"
  if [[ -f "$marker" ]]; then
    tr -d '[:space:]' < "$marker"
  fi
}

ROLE=""
TARGET=""
RESIDENT_ATTACH=0

case $# in
  0)
    TARGET="$(resolve_root "")"
    if [[ -n "$(read_mono_router_resident "$TARGET")" ]]; then
      RESIDENT_ATTACH=1
    else
      ROLE="coordinator"
    fi
    ;;
  1)
    if looks_like_path "$1"; then
      TARGET="$(resolve_root "$1")"
      if [[ -n "$(read_mono_router_resident "$TARGET")" ]]; then
        RESIDENT_ATTACH=1
      else
        ROLE="coordinator"
      fi
    else
      TARGET="$(resolve_root "")"
      case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
        resident|res) RESIDENT_ATTACH=1 ;;
        *) ROLE="$1" ;;
      esac
    fi
    ;;
  *)
    TARGET="$(resolve_root "$2")"
    case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
      resident|res) RESIDENT_ATTACH=1 ;;
      *) ROLE="$1" ;;
    esac
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

tmux_server_alive() {
  # `tmux info` fails with "no current client" on a live headless server
  # (SWARMFORGE_TERMINAL=none) — list-sessions talks to the server directly.
  tmux -S "$1" list-sessions >/dev/null 2>&1
}

if ! tmux_server_alive "$SOCK"; then
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

resolve_live_resident() {
  local marked="$1"
  local session=""

  if [[ -n "$marked" ]]; then
    session="$(resolve_session "$marked" 2>/dev/null || true)"
    if [[ -n "$session" ]] && tmux -S "$SOCK" has-session -t "$session" 2>/dev/null; then
      printf '%s' "$marked"
      return 0
    fi
    echo "Mono-router marker says '$marked' but that session is not live; picking live resident." >&2
  fi

  if [[ -f "$ROLES_FILE" ]]; then
    while IFS=$'\t' read -r role _ _ session _ _ _ _; do
      [[ -z "$role" || "$role" == "coordinator" ]] && continue
      if tmux -S "$SOCK" has-session -t "$session" 2>/dev/null; then
        printf '%s' "$role"
        return 0
      fi
    done < "$ROLES_FILE"
  fi

  for session in $(tmux -S "$SOCK" list-sessions -F '#{session_name}' 2>/dev/null); do
    case "$session" in
      swarmforge-coordinator) continue ;;
      swarmforge-*)
        printf '%s' "${session#swarmforge-}"
        return 0
        ;;
    esac
  done

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
if [[ "$RESIDENT_ATTACH" -eq 1 ]]; then
  ROLE="$(resolve_live_resident "$(read_mono_router_resident "$TARGET")")" || {
    echo "No live mono-router resident session found." >&2
    list_sessions
    exit 1
  }
fi

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

echo "Attaching to $SESSION (project: $TARGET${ROLE:+; role=$ROLE})" >&2
echo "Detach with Ctrl-b d" >&2
exec tmux -S "$SOCK" attach-session -t "$SESSION"
