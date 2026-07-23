#!/usr/bin/env bash
# One-shot Concierge/front-desk LLM run — pack-aware, invoked inside tmux.
# Writes operator_runtime-compatible JSON to result-file.
#
# Usage: run_ancillary_front_desk.sh <root> <prompt-file> <result-file>
set -euo pipefail

ROOT="${1:?}"
PROMPT_FILE="${2:?}"
RESULT_FILE="${3:?}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ancillary_provider_lib.sh
source "$SCRIPT_DIR/ancillary_provider_lib.sh"

ancillary_provider_load "$ROOT"
ancillary_provider_require_credentials

FAMILY="$(ancillary_provider_family)"
MODEL="${FRONT_DESK_OPERATOR_MODEL:-$(ancillary_provider_default_model front_desk)}"
EFFORT="${FRONT_DESK_OPERATOR_EFFORT:-high}"
TEXT_OUT="${RESULT_FILE}.stdout"
ERR_OUT="${RESULT_FILE}.err"
SETTINGS_TEMPLATE="$SCRIPT_DIR/front-desk-operator.claude-settings.json"
SETTINGS="$SETTINGS_TEMPLATE"

eval "$(ancillary_provider_pane_exports)"
cd "$ROOT"

case "$FAMILY" in
  openrouter|claude_direct)
    if [[ "$FAMILY" == openrouter ]]; then
      SETTINGS="$ROOT/.swarmforge/operator/front-desk-operator.claude-settings.json"
      ancillary_provider_write_claude_settings "$SETTINGS_TEMPLATE" "$SETTINGS" "$MODEL" "$EFFORT"
    fi
    if ! claude -p --output-format json --tools "" --settings "$SETTINGS" "$(cat "$PROMPT_FILE")" > "$RESULT_FILE" 2>"$ERR_OUT"; then
      if [[ ! -s "$RESULT_FILE" ]]; then
        ancillary_provider_write_front_desk_result_json /dev/null "$RESULT_FILE" true
      fi
    fi
    ;;
  gemini)
    if gemini -y -p "$(cat "$PROMPT_FILE")" -m "$MODEL" > "$TEXT_OUT" 2>"$ERR_OUT"; then
      ancillary_provider_write_front_desk_result_json "$TEXT_OUT" "$RESULT_FILE" false
    else
      ancillary_provider_write_front_desk_result_json "$TEXT_OUT" "$RESULT_FILE" true
    fi
    ;;
  codex)
    if codex exec "$(cat "$PROMPT_FILE")" -m "$MODEL" > "$TEXT_OUT" 2>"$ERR_OUT"; then
      ancillary_provider_write_front_desk_result_json "$TEXT_OUT" "$RESULT_FILE" false
    else
      ancillary_provider_write_front_desk_result_json "$TEXT_OUT" "$RESULT_FILE" true
    fi
    ;;
  openai_aider)
    if aider --yes --no-git --model "$MODEL" --message "$(cat "$PROMPT_FILE")" > "$TEXT_OUT" 2>"$ERR_OUT"; then
      ancillary_provider_write_front_desk_result_json "$TEXT_OUT" "$RESULT_FILE" false
    else
      ancillary_provider_write_front_desk_result_json "$TEXT_OUT" "$RESULT_FILE" true
    fi
    ;;
  *)
    echo "run_ancillary_front_desk: unsupported family $FAMILY" >&2
    exit 1
    ;;
esac
