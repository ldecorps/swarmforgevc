#!/usr/bin/env bash
# start-swarm-ollama-ista-local-model-claude-forge.sh — BL-2078: standing
# all-local forge, the live ollama-ista-local-model-qwen-coord-mono-router
# pack's seven iq3 seats (ISTA IQ3_S via local-model / qwen CLI tools)
# standing together instead of rotating, plus its Claude coordinator.
# Allowed only behind the shim's decode slot (BL-2077); see
# swarmforge/packs/ollama-ista-local-model-claude-coord-forge.conf.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

ISTA_MODEL='ista-iq3s-coder:latest'
ISTA_BASE_TAG='hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:IQ3_S'
ISTA_MODELFILE="$SCRIPT_DIR/swarmforge/packs/ista-iq3s-coder.Modelfile"

unset SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY SWARMFORGE_USE_QWEN || true
# local-model panes force OPENAI_* to the loopback endpoint; the Claude
# coordinator ignores them.
export OPENAI_API_BASE="${OPENAI_API_BASE:-http://127.0.0.1:11434/v1}"
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://127.0.0.1:11434/v1}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-ollama}"
export OLLAMA_API_KEY="${OLLAMA_API_KEY:-ollama}"
export SWARMFORGE_OLLAMA_CONTEXT_LENGTH="${SWARMFORGE_OLLAMA_CONTEXT_LENGTH:-49152}"
export QWEN_CODE_SUPPRESS_YOLO_WARNING="${QWEN_CODE_SUPPRESS_YOLO_WARNING:-1}"

for bin in ollama qwen claude; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "ERROR: $bin not on PATH" >&2
    exit 1
  fi
done
if [[ ! -f "$SCRIPT_DIR/.qwen/settings.json" ]]; then
  echo "ERROR: missing .qwen/settings.json (ISTA openai provider + think:false)" >&2
  exit 1
fi
if [[ ! -f "$ISTA_MODELFILE" ]]; then
  echo "ERROR: missing $ISTA_MODELFILE" >&2
  exit 1
fi
# Ensure the seat alias exists with the Modelfile's current num_ctx
# (idempotent by tag name only, same as start-swarm-ollama-ista-local-model-claude.sh).
if ! ollama show "$ISTA_MODEL" >/dev/null 2>&1; then
  echo "Creating ollama alias $ISTA_MODEL (num_ctx 49152) from $ISTA_BASE_TAG ..."
  ollama create "$ISTA_MODEL" -f "$ISTA_MODELFILE"
fi

bash "$SCRIPT_DIR/swarmforge/scripts/local_coder_battery_staffing_gate.sh" "$SCRIPT_DIR"
# BL-2078: the pack-shape gate refuses this standing forge whenever its
# seats cannot reach Ollama through the shim's decode slot (BL-2077) -
# run before the pack ever launches.
bash "$SCRIPT_DIR/swarmforge/scripts/local_ollama_pack_shape_gate.sh" \
  "$SCRIPT_DIR" ollama-ista-local-model-claude-coord-forge

# Same canary escape hatch as the mono-router local-model packs: steward
# resolve-seat has no mapping for local-model + hf.co ISTA, and IQ3_S is
# not registry-certified.
export PACK_STAFFING_SKIP_GATE="${PACK_STAFFING_SKIP_GATE:-1}"

# Upsert the ISTA provider into ~/.qwen/settings.json when missing, same
# as start-swarm-ollama-ista-local-model-claude.sh.
USER_QWEN_SETTINGS="${HOME}/.qwen/settings.json"
if command -v python3 >/dev/null 2>&1 && [[ -f "$USER_QWEN_SETTINGS" ]]; then
  python3 - "$USER_QWEN_SETTINGS" "$SCRIPT_DIR/.qwen/settings.json" "$ISTA_MODEL" <<'PY'
import json, sys
user_path, proj_path, model_id = sys.argv[1], sys.argv[2], sys.argv[3]
with open(user_path, encoding="utf-8") as f:
    user = json.load(f)
with open(proj_path, encoding="utf-8") as f:
    proj = json.load(f)
providers = user.setdefault("modelProviders", {}).setdefault("openai", [])
if any(isinstance(e, dict) and e.get("id") == model_id for e in providers):
    print(f"qwen settings: {model_id} already registered in {user_path}")
    raise SystemExit(0)
proj_entries = (proj.get("modelProviders") or {}).get("openai") or []
entry = next((e for e in proj_entries if isinstance(e, dict) and e.get("id") == model_id), None)
if entry is None:
    print(f"WARNING: project settings lack entry for {model_id}", file=sys.stderr)
    raise SystemExit(0)
providers.append(entry)
user.setdefault("env", {}).setdefault("OLLAMA_API_KEY", "ollama")
user.setdefault("security", {}).setdefault("auth", {})["selectedType"] = "openai"
with open(user_path, "w", encoding="utf-8") as f:
    json.dump(user, f, indent=2)
    f.write("\n")
print(f"qwen settings: registered {model_id} in {user_path}")
PY
fi

export SWARMFORGE_PACK=ollama-ista-local-model-claude-coord-forge
exec "$SCRIPT_DIR/start-swarm.sh" "$@"
