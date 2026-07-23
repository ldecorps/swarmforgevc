#!/usr/bin/env bash
# BL-334 — launch the RESTRICTED, front-desk-only disposable LLM (Concierge).
#
# Provider follows the active swarm pack (see ancillary_provider_lib.sh) —
# never bills a different vendor than the pipeline agents.
#
# Usage: launch_front_desk_operator.sh <project-root> <prompt-file> <result-file>
#
# Env:
#   FRONT_DESK_LAUNCH_DRYRUN=1
#   FRONT_DESK_OPERATOR_MODEL=...
#   FRONT_DESK_OPERATOR_EFFORT=...
set -euo pipefail

ROOT="${1:?usage: launch_front_desk_operator.sh <project-root> <prompt-file> <result-file>}"
PROMPT_FILE="${2:?usage: launch_front_desk_operator.sh <project-root> <prompt-file> <result-file>}"
RESULT_FILE="${3:?usage: launch_front_desk_operator.sh <project-root> <prompt-file> <result-file>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ancillary_provider_lib.sh
source "$SCRIPT_DIR/ancillary_provider_lib.sh"
ancillary_provider_load "$ROOT"

OP_DIR="$ROOT/.swarmforge/operator"
SESSION="front-desk-operator"
FD_SOCK="$OP_DIR/front-desk-operator-tmux.sock"
RUNNER="$SCRIPT_DIR/run_ancillary_front_desk.sh"

mkdir -p "$OP_DIR"

if [[ "${FRONT_DESK_LAUNCH_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN launch_front_desk_operator session=%s\n' "$SESSION"
  printf 'DRYRUN pack=%s provider=%s\n' "$(ancillary_provider_pack)" "$(ancillary_provider_dryrun_label)"
  printf 'DRYRUN cmd: %q %q %q %q\n' "$RUNNER" "$ROOT" "$PROMPT_FILE" "$RESULT_FILE"
  case "$(ancillary_provider_family)" in
    openrouter|claude_direct)
      printf "DRYRUN would run: claude -p --output-format json --tools '' --settings <pack-settings>\n"
      ;;
  esac
  exit 0
fi

ancillary_provider_require_credentials

if tmux -S "$FD_SOCK" has-session -t "$SESSION" 2>/dev/null; then
  echo "launch_front_desk_operator: session already present; not double-launching" >&2
  exit 0
fi

ancillary_provider_fill_tmux_env
chmod +x "$RUNNER"

tmux -S "$FD_SOCK" new-session -d -s "$SESSION" -n "$SESSION" "${ANCILLARY_TMUX_ENV[@]}" \
  "bash '$RUNNER' '$ROOT' '$PROMPT_FILE' '$RESULT_FILE'"

sleep 0.3
tmux -S "$FD_SOCK" list-panes -t "$SESSION" -F '#{pane_pid}' 2>/dev/null | head -1 > "$OP_DIR/front-desk-operator.pid" || true
echo "launch_front_desk_operator: started $SESSION on $FD_SOCK (pack=$(ancillary_provider_pack) provider=$(ancillary_provider_family))"
