#!/usr/bin/env bash
# BL-324: shell-callable per-role tmux/config primitives - the impure half
# role_lifecycle_cli.bb's real adapters shell out to for parking/unparking
# ONE role. Sources the REAL swarmforge.sh (BL-089's own ZSH_EVAL_CONTEXT
# toplevel guard skips the whole-swarm launch sequence when sourced) to
# reuse its config parsing + session/launch-script machinery exactly -
# never a second implementation of either. Mirrors test_resume_on_start.sh's
# own proven "source, parse_config, act on one role by index" pattern.
#
# Usage:
#   role_lifecycle.sh <project-root> row-for <role>
#     Prints the role's roles.tsv row (tab-separated, 8 fields) exactly as
#     write_roles_file would - re-derived from swarmforge.conf, never a
#     second stored copy that could drift.
#   role_lifecycle.sh <project-root> kill-session <role>
#     Kills the role's tmux session if one exists (a no-op otherwise).
#   role_lifecycle.sh <project-root> unpark <role>
#     Creates the role's tmux session and launches it - the SAME
#     create_role_session + launch_role sequence the real top-level swarm
#     launch uses, for exactly one role instead of the whole roster.

set -euo pipefail

usage() {
  echo "Usage: role_lifecycle.sh <project-root> row-for <role> | kill-session <role> | unpark <role>" >&2
  exit 1
}

PROJECT_ROOT="${1:-}"
SUBCOMMAND="${2:-}"
ROLE="${3:-}"
[[ -n "$PROJECT_ROOT" && -n "$SUBCOMMAND" && -n "$ROLE" ]] || usage

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/swarmforge.sh"

case "$SUBCOMMAND" in
  row-for|kill-session|unpark) ;;
  *) usage ;;
esac

zsh -c "
  export SWARMFORGE_TERMINAL=none
  source '$SWARMFORGE_SH' '$PROJECT_ROOT'
  TERMINAL_BACKEND=\"\$(detect_terminal_backend)\"
  load_terminal_backend \"\$TERMINAL_BACKEND\"
  parse_config
  found=0
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    if [[ \"\${ROLES[\$i]}\" == \"$ROLE\" ]]; then
      found=1
      case '$SUBCOMMAND' in
        row-for)
          printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
            \"\${ROLES[\$i]}\" \"\${WORKTREE_NAMES[\$i]}\" \"\${WORKTREE_PATHS[\$i]}\" \
            \"\${SESSIONS[\$i]}\" \"\${DISPLAY_NAMES[\$i]}\" \"\${AGENTS[\$i]}\" \
            \"\${RECEIVE_MODES[\$i]}\" \"\${IDLE_CLEAR_FLAGS[\$i]}\"
          ;;
        kill-session)
          if tmux -S \"\$TMUX_SOCKET\" has-session -t \"\${SESSIONS[\$i]}\" 2>/dev/null; then
            tmux -S \"\$TMUX_SOCKET\" kill-session -t \"\${SESSIONS[\$i]}\"
          fi
          ;;
        unpark)
          # BL-368: create_role_session refuses (nonzero) when this role's
          # previous claude process is still alive per its own heartbeat pid
          # - never launch into a session that was refused.
          if create_role_session \"\${SESSIONS[\$i]}\" \"\${DISPLAY_NAMES[\$i]}\" \"\${ROLES[\$i]}\"; then
            launch_role \$i
          else
            echo \"unpark refused: \${ROLES[\$i]}'s previous claude process is still alive\" >&2
            exit 1
          fi
          ;;
      esac
      break
    fi
  done
  if [[ \"\$found\" -ne 1 ]]; then
    echo \"role not found in $PROJECT_ROOT's config: $ROLE\" >&2
    exit 1
  fi
"
