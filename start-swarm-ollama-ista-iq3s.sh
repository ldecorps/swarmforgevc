#!/usr/bin/env bash
# start-swarm-ollama-ista-iq3s.sh — local Ollama mono-router on
# hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:IQ3_S (sibling of
# start-swarm-ollama-qwen2.5-coder.sh, model swapped only). Happy path
# requires Ollama up; does NOT require cloud Token Plan keys.
# Staffing gate: a cited BL-1127 coder battery *pass* is required (or
# LOCAL_CODER_BATTERY_SKIP_GATE=1 for emergency bypass).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

unset SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY SWARMFORGE_USE_QWEN || true
export OPENAI_API_BASE="${OPENAI_API_BASE:-http://127.0.0.1:11434/v1}"
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://127.0.0.1:11434/v1}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-ollama}"

if ! command -v ollama >/dev/null 2>&1; then
  echo "ERROR: ollama not on PATH (install Ollama for the local happy path)" >&2
  exit 1
fi
if ! command -v aider >/dev/null 2>&1; then
  echo "ERROR: aider not on PATH" >&2
  exit 1
fi
if [[ ! -f "$SCRIPT_DIR/.aider.model.settings.yml" ]]; then
  echo "ERROR: missing .aider.model.settings.yml (think:false wiring for this thinking model)" >&2
  exit 1
fi

bash "$SCRIPT_DIR/swarmforge/scripts/local_coder_battery_staffing_gate.sh" "$SCRIPT_DIR"
bash "$SCRIPT_DIR/swarmforge/scripts/local_ollama_pack_shape_gate.sh" \
  "$SCRIPT_DIR" ollama-ista-iq3s-mono-router

export SWARMFORGE_PACK=ollama-ista-iq3s-mono-router
exec "$SCRIPT_DIR/start-swarm.sh" "$@"
