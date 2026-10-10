#!/usr/bin/env bash
# BL-1142: launch gate — local Ollama path must match the durable pack-shape
# decision (mono-router depth ≤ LOCAL_OLLAMA_MONO_MAX_DEPTH). Refuses
# qwen-forge / Token Plan forge substitutes and uncapped multi-seat shapes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=local_ollama_pack_shape_lib.sh
source "$SCRIPT_DIR/local_ollama_pack_shape_lib.sh"

ROOT="${1:-}"
PACK_NAME="${2:-${SWARMFORGE_PACK:-ollama-qwen3-mono-router}}"

if [[ -z "$ROOT" ]]; then
  echo "usage: local_ollama_pack_shape_gate.sh <project-root> [pack-name]" >&2
  exit 2
fi

if bl1142_is_forbidden_substitute_pack "$PACK_NAME"; then
  echo "ERROR: BL-1142 — pack '$PACK_NAME' is not a local Ollama path substitute." >&2
  echo "Use ollama-qwen3-mono-router via ./start-swarm-ollama-qwen.sh (mono decision)." >&2
  echo "Do not launch qwen-forge / Token Plan full forge for this host." >&2
  exit 1
fi

PACK_FILE="$ROOT/swarmforge/packs/${PACK_NAME}.conf"
if [[ ! -f "$PACK_FILE" ]]; then
  echo "ERROR: BL-1142 — pack conf missing: $PACK_FILE" >&2
  exit 1
fi

BODY="$(cat "$PACK_FILE")"
SHAPE="$(bl1142_classify_pack_shape "$BODY")"

if ! bl1142_shape_allowed_for_local_decision "$SHAPE"; then
  if [[ "$SHAPE" == "capped-forge" ]]; then
    echo "ERROR: BL-2078 — pack '$PACK_NAME' is a capped standing forge, but no decode slot is reachable (SWARMFORGE_LOCAL_MODEL_SHIM=${SWARMFORGE_LOCAL_MODEL_SHIM:-on})." >&2
    echo "A standing forge may launch only while its seats reach Ollama through the tool-call shim's decode slot (BL-2077)." >&2
    echo "See docs/how-to/BL-1142-local-ollama-mono-vs-forge-cpu.md" >&2
    exit 1
  fi
  echo "ERROR: BL-1142 — pack shape '$SHAPE' is not the durable local decision." >&2
  echo "Decision: mono-router with active_backlog_max_depth ≤ ${LOCAL_OLLAMA_MONO_MAX_DEPTH}, or a capped standing forge (≤8 windows) behind the decode slot (BL-2077/BL-2078)." >&2
  echo "See docs/how-to/BL-1142-local-ollama-mono-vs-forge-cpu.md" >&2
  echo "Refusing uncapped / fuller-forge staffing that would wedge Ollama." >&2
  exit 1
fi

echo "BL-1142 pack-shape gate: $PACK_NAME is $SHAPE (mono decision)"
exit 0
