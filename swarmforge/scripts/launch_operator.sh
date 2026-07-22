#!/usr/bin/env bash
# Operator v2 — disposable supervisor LLM. Provider follows active swarm pack.
#
# Usage: launch_operator.sh <project-root> <inflight-events-file>
set -euo pipefail

ROOT="${1:?usage: launch_operator.sh <project-root> <inflight-events-file>}"
EVENTS="${2:?usage: launch_operator.sh <project-root> <inflight-events-file>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ancillary_provider_lib.sh
source "$SCRIPT_DIR/ancillary_provider_lib.sh"
ancillary_provider_load "$ROOT"

OP_DIR="$ROOT/.swarmforge/operator"
SETTINGS_TEMPLATE="$SCRIPT_DIR/operator.claude-settings.json"
PROMPT="$ROOT/swarmforge/roles/operator.prompt"
SESSION="operator"
RC_NAME="Operator"
OP_SOCK="$OP_DIR/operator-tmux.sock"
FAMILY="$(ancillary_provider_family)"
MODEL="${OPERATOR_MODEL:-$(ancillary_provider_default_model operator)}"
EFFORT="${OPERATOR_EFFORT:-high}"
COMBINED_KICKOFF="$OP_DIR/operator-kickoff-combined.txt"

mkdir -p "$OP_DIR"

KICKOFF="You are the Operator — the external supervisor of the SwarmForge swarm (you are NOT a swarm agent). Read your system prompt, then process the pending events in ${EVENTS} and the live swarm state. Take the minimal correct action per your prompt (health check, ONE targeted nudge, recovery, or escalate), update .swarmforge/operator/status.json if warranted, then as your FINAL action run: touch ${OP_DIR}/operator.done — and stop."

if [[ "${OPERATOR_LAUNCH_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN launch_operator session=%s rc=%s events=%s\n' "$SESSION" "$RC_NAME" "$EVENTS"
  printf 'DRYRUN pack=%s provider=%s model=%s\n' "$(ancillary_provider_pack)" "$FAMILY" "$MODEL"
  case "$FAMILY" in
    openrouter|claude_direct)
      printf 'DRYRUN would run: claude --settings %s --dangerously-skip-permissions --remote-control %s --append-system-prompt-file %s --model %s --effort %s\n' \
        "$SETTINGS_TEMPLATE" "$RC_NAME" "$PROMPT" "$MODEL" "$EFFORT"
      ;;
  esac
  exit 0
fi

ancillary_provider_require_credentials

if tmux -S "$OP_SOCK" has-session -t "$SESSION" 2>/dev/null; then
  echo "launch_operator: operator session already present; not double-launching" >&2
  exit 0
fi

{
  if [[ -f "$PROMPT" ]]; then cat "$PROMPT"; printf '\n\n'; fi
  printf '%s\n' "$KICKOFF"
} > "$COMBINED_KICKOFF"

ancillary_provider_fill_tmux_env
PROVIDER_ENV="$(ancillary_provider_pane_exports)"
RUNNER="$OP_DIR/operator-launch.sh"

case "$FAMILY" in
  openrouter|claude_direct)
    SETTINGS="$SETTINGS_TEMPLATE"
    if [[ "$FAMILY" == openrouter ]]; then
      SETTINGS="$OP_DIR/operator.claude-settings.json"
      ancillary_provider_write_claude_settings "$SETTINGS_TEMPLATE" "$SETTINGS" "$MODEL" "$EFFORT"
    fi
    cat > "$RUNNER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd '$ROOT'
${PROVIDER_ENV}
export PATH='$ROOT/swarmforge/scripts':\$PATH
exec claude --settings '$SETTINGS' \\
  --dangerously-skip-permissions \\
  --remote-control '$RC_NAME' \\
  --append-system-prompt-file '$PROMPT' \\
  -n Operator \\
  ${MODEL:+--model '$MODEL' --effort '$EFFORT'} \\
  '$KICKOFF'
EOF
    ;;
  gemini)
    cat > "$RUNNER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd '$ROOT'
${PROVIDER_ENV}
export PATH='$ROOT/swarmforge/scripts':\$PATH
exec gemini -y -m '$MODEL' -p "\$(cat '$COMBINED_KICKOFF')"
EOF
    ;;
  codex)
    cat > "$RUNNER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd '$ROOT'
${PROVIDER_ENV}
export PATH='$ROOT/swarmforge/scripts':\$PATH
exec codex -m '$MODEL' "\$(cat '$COMBINED_KICKOFF')"
EOF
    ;;
  openai_aider)
    cat > "$RUNNER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd '$ROOT'
${PROVIDER_ENV}
export PATH='$ROOT/swarmforge/scripts':\$PATH
exec aider --yes --no-git --model '$MODEL' --message "\$(cat '$COMBINED_KICKOFF')"
EOF
    ;;
  *)
    echo "launch_operator: unsupported provider family $FAMILY for pack $(ancillary_provider_pack)" >&2
    exit 1
    ;;
esac
chmod +x "$RUNNER"

tmux -S "$OP_SOCK" new-session -d -s "$SESSION" -n "$SESSION" "${ANCILLARY_TMUX_ENV[@]}" \
  "bash '$RUNNER'"

sleep 0.3
tmux -S "$OP_SOCK" list-panes -t "$SESSION" -F '#{pane_pid}' 2>/dev/null | head -1 > "$OP_DIR/operator.pid" || true
echo "launch_operator: started $SESSION on $OP_SOCK (pack=$(ancillary_provider_pack) provider=$FAMILY model=$MODEL)"
