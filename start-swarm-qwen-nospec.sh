#!/usr/bin/env bash
#
# start-swarm-qwen-nospec.sh — Qwen Token Plan mono-router.
#
# Pack: qwen-mono-router-nospec
#   Pipeline seats + coordinator → Token Plan qwen via aider
#   Specifier → qwen3.8-max (best tier on Token Plan; no Kimi/OpenRouter)
#
# Usage:
#   ./start-swarm-qwen-nospec.sh [options] [target-path]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1090
source "$HOME/.zshenv" 2>/dev/null || true
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

unset SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY SWARMFORGE_USE_QWEN OPENAI_API_BASE OPENAI_BASE_URL || true
unset SWARMFORGE_OPENROUTER_ROLES || true

if [[ -z "${QWEN_API_KEY:-}" && -n "${BAILIAN_TOKEN_PLAN_API_KEY:-}" ]]; then
  export QWEN_API_KEY="$BAILIAN_TOKEN_PLAN_API_KEY"
fi
if [[ -z "${QWEN_API_KEY:-}" && -n "${BAILIAN_CODING_PLAN_API_KEY:-}" ]]; then
  export QWEN_API_KEY="$BAILIAN_CODING_PLAN_API_KEY"
fi

if [[ -z "${QWEN_API_KEY:-}" ]]; then
  echo "ERROR: QWEN_API_KEY missing (or BAILIAN_TOKEN_PLAN_API_KEY in ~/.zshenv)" >&2
  exit 1
fi
if ! command -v aider >/dev/null 2>&1; then
  echo "ERROR: aider not on PATH" >&2
  exit 1
fi

export SWARMFORGE_USE_QWEN=1
export SWARMFORGE_PACK=qwen-mono-router-nospec
exec "$SCRIPT_DIR/start-swarm.sh" "$@"
