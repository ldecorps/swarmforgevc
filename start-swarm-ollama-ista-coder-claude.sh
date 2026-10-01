#!/usr/bin/env bash
# start-swarm-ollama-ista-coder-claude.sh — mono-router with coder on local
# ollama (ISTA-DASLab Qwen3.8-27B IQ3_S, aider, parcel driver) and Claude on
# every other seat. See swarmforge/packs/ollama-ista-coder-claude-mono-router.conf.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

unset SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY SWARMFORGE_USE_QWEN || true
# The aider coder's litellm reads OPENAI_BASE_URL before --openai-api-base;
# the claude seats ignore OPENAI_*.
export OPENAI_API_BASE="${OPENAI_API_BASE:-http://127.0.0.1:11434/v1}"
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://127.0.0.1:11434/v1}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-ollama}"

for bin in ollama aider claude; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "ERROR: $bin not on PATH" >&2
    exit 1
  fi
done
if [[ ! -f "$SCRIPT_DIR/.aider.model.settings.yml" ]]; then
  echo "ERROR: missing .aider.model.settings.yml (think:false wiring for the local coder)" >&2
  exit 1
fi

bash "$SCRIPT_DIR/swarmforge/scripts/local_coder_battery_staffing_gate.sh" "$SCRIPT_DIR"
bash "$SCRIPT_DIR/swarmforge/scripts/local_ollama_pack_shape_gate.sh" \
  "$SCRIPT_DIR" ollama-ista-coder-claude-mono-router

export SWARMFORGE_PACK=ollama-ista-coder-claude-mono-router
exec "$SCRIPT_DIR/start-swarm.sh" "$@"
