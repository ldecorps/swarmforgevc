#!/usr/bin/env bash
# start-swarm-ollama-qwen2.5-coder.sh — local Ollama mono-router, ONE model
# on every seat: qwen2.5-coder:latest, the certified local baseline
# (see the pack conf). Sibling of the single-model
# start-swarm-ollama-qwen3-8b*.sh scripts. Does NOT require cloud Token
# Plan keys. Staffing gate: a cited BL-1127 coder battery *pass* is
# required (or LOCAL_CODER_BATTERY_SKIP_GATE=1 for emergency bypass).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

unset SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY SWARMFORGE_USE_QWEN || true
export OPENAI_API_BASE="${OPENAI_API_BASE:-http://127.0.0.1:11434/v1}"
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://127.0.0.1:11434/v1}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-ollama}"
# 2026-09-23: qwen2.5-coder now serves 32,768 tokens (packs/qwen2.5-coder-32k.
# Modelfile). aider sizes its repo map at window/8 (capped 4096), so the map
# would silently quadruple too; hold it at the 1024 it has always had so the
# window is the only variable while its effect is observed.
export AIDER_MAP_TOKENS="${AIDER_MAP_TOKENS:-1024}"

if ! command -v ollama >/dev/null 2>&1; then
  echo "ERROR: ollama not on PATH (install Ollama for the local happy path)" >&2
  exit 1
fi
if ! command -v aider >/dev/null 2>&1; then
  echo "ERROR: aider not on PATH" >&2
  exit 1
fi

bash "$SCRIPT_DIR/swarmforge/scripts/local_coder_battery_staffing_gate.sh" "$SCRIPT_DIR"
bash "$SCRIPT_DIR/swarmforge/scripts/local_ollama_pack_shape_gate.sh" \
  "$SCRIPT_DIR" ollama-qwen2.5-coder-mono-router

export SWARMFORGE_PACK=ollama-qwen2.5-coder-mono-router
exec "$SCRIPT_DIR/start-swarm.sh" "$@"
