#!/usr/bin/env bash
# start-swarm-ollama-slevin-local-model-forge.sh — BL-2078 standing forge
# shape with prepared Slevin (Qwen3.6-35B-A3B IQ3 -novision) on every
# pipeline seat AND the coordinator. Allowed only behind the shim's
# decode slot.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

SLEVIN_MODEL='prepared-slevinw-qwen3.6-35b-a3b-gguf-qwen3.6-35b-a3b-iq3-novision:latest'
SLEVIN_BATTERY="$(ls -1t "$SCRIPT_DIR"/backlog/evidence/local-coder-probe-prepared-slevinw-*.md 2>/dev/null | head -1 || true)"

unset SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY SWARMFORGE_USE_QWEN || true
export OPENAI_API_BASE="${OPENAI_API_BASE:-http://127.0.0.1:11434/v1}"
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://127.0.0.1:11434/v1}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-ollama}"
export OLLAMA_API_KEY="${OLLAMA_API_KEY:-ollama}"
export QWEN_CODE_SUPPRESS_YOLO_WARNING="${QWEN_CODE_SUPPRESS_YOLO_WARNING:-1}"

for bin in ollama qwen; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "ERROR: $bin not on PATH" >&2
    exit 1
  fi
done

if ! ollama show "$SLEVIN_MODEL" >/dev/null 2>&1; then
  echo "ERROR: ollama alias missing: $SLEVIN_MODEL" >&2
  echo "Create the -novision prepared alias before launching." >&2
  exit 1
fi

bash "$SCRIPT_DIR/swarmforge/scripts/local_coder_battery_staffing_gate.sh" "$SCRIPT_DIR"
bash "$SCRIPT_DIR/swarmforge/scripts/local_ollama_pack_shape_gate.sh" \
  "$SCRIPT_DIR" ollama-slevin-local-model-forge

if [[ -n "$SLEVIN_BATTERY" && -f "$SLEVIN_BATTERY" ]]; then
  export LOCAL_CODER_BATTERY_EVIDENCE_PATH="$SLEVIN_BATTERY"
fi

# Pin to 1 (not ${VAR:-1}): Cursor sandbox restore can leave the literal
# '${PACK_STAFFING_SKIP_GATE:-1}' in the environment, which then survives a
# :-default expand and fails the gate's == "1" check.
export PACK_STAFFING_SKIP_GATE=1
export SWARMFORGE_PACK=ollama-slevin-local-model-forge
exec env PACK_STAFFING_SKIP_GATE=1 SWARMFORGE_PACK=ollama-slevin-local-model-forge \
  "$SCRIPT_DIR/start-swarm.sh" "$@"
