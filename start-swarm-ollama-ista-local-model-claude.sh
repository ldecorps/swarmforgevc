#!/usr/bin/env bash
# start-swarm-ollama-ista-local-model-claude.sh — canary mono-router:
# coder on local ollama (ISTA IQ3_S via local-model / qwen CLI tools);
# Claude on every other seat. See
# swarmforge/packs/ollama-ista-local-model-claude-mono-router.conf.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

ISTA_MODEL='ista-iq3s-coder:latest'
ISTA_BASE_TAG='hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:IQ3_S'
ISTA_BATTERY="$SCRIPT_DIR/backlog/evidence/BL-1127-coder-battery-ollama-hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:IQ3_S-20260923T063726Z.md"
ISTA_MODELFILE="$SCRIPT_DIR/swarmforge/packs/ista-iq3s-coder.Modelfile"

unset SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY SWARMFORGE_USE_QWEN || true
# local-model pane forces OPENAI_* to the loopback endpoint; Claude seats ignore them.
export OPENAI_API_BASE="${OPENAI_API_BASE:-http://127.0.0.1:11434/v1}"
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://127.0.0.1:11434/v1}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-ollama}"
export OLLAMA_API_KEY="${OLLAMA_API_KEY:-ollama}"
# Seat alias needs headroom past 32k: full coder.md bootstrap is ~16k
# tokens (8k OOMs) and qwen CLI's own first-turn overhead adds ~17-18k
# more (BL-1829) - 32768 refused at launch (BL-1801 gate). Raised to
# 49152 2026-09-30 (operator directive), kept below a straight double
# given this host's tight RAM.
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
# (idempotent by tag name only - if the alias already exists with a STALE
# num_ctx, this does not recreate it; recreate by hand with `ollama create`
# after editing the Modelfile, the same way the 2026-09-30 32768->49152
# bump was applied to the already-running alias).
if ! ollama show "$ISTA_MODEL" >/dev/null 2>&1; then
  echo "Creating ollama alias $ISTA_MODEL (num_ctx 49152) from $ISTA_BASE_TAG ..."
  ollama create "$ISTA_MODEL" -f "$ISTA_MODELFILE"
fi

# Prefer the ISTA-specific BL-1127 pass over whatever is newest in evidence/.
if [[ -f "$ISTA_BATTERY" ]]; then
  export LOCAL_CODER_BATTERY_EVIDENCE_PATH="$ISTA_BATTERY"
fi

bash "$SCRIPT_DIR/swarmforge/scripts/local_coder_battery_staffing_gate.sh" "$SCRIPT_DIR"
bash "$SCRIPT_DIR/swarmforge/scripts/local_ollama_pack_shape_gate.sh" \
  "$SCRIPT_DIR" ollama-ista-local-model-claude-mono-router

# Canary: steward resolve-seat has no mapping for local-model + hf.co ISTA
# (nor for aider + 127.0.0.1:11434), and IQ3_S is not registry-certified —
# only IQ2_S is a candidate. BL-1318 escape hatch; launch prints OVERRIDE
# warnings per seat. Clear by registering the seat identity + role matrix.
export PACK_STAFFING_SKIP_GATE="${PACK_STAFFING_SKIP_GATE:-1}"


# Upsert the ISTA provider into ~/.qwen/settings.json when missing so the
# pane's qwen CLI finds the model even if the workspace is not /trust'd
# (project .qwen/settings.json is ignored until trusted).
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

export SWARMFORGE_PACK=ollama-ista-local-model-claude-mono-router
exec "$SCRIPT_DIR/start-swarm.sh" "$@"
