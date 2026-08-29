#!/usr/bin/env bash
#
# start-swarm-qwen.sh — headless mono-router on Alibaba Token Plan (Qwen).
#
# Default pack: qwen-anthropic-mono-router (Claude Code → Anthropic-compat SEA).
# Alternate:    SWARMFORGE_PACK=qwen-mono-router ./start-swarm-qwen.sh  # aider OpenAI-compat
#
# Lite plan concurrency is 1–2 agents — mono-router depth 1 only.
#
# Usage:
#   ./start-swarm-qwen.sh [options] [target-path]   # same flags as start-swarm.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1090
source "$HOME/.zshenv" 2>/dev/null || true
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

unset SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY SWARMFORGE_USE_QWEN OPENAI_API_BASE OPENAI_BASE_URL || true
unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY || true

# Token Plan Personal: BAILIAN_TOKEN_PLAN_API_KEY (docs). Also accept legacy aliases.
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

export SWARMFORGE_USE_QWEN=1
export SWARMFORGE_PACK="${SWARMFORGE_PACK:-qwen-anthropic-mono-router}"

if [[ "$SWARMFORGE_PACK" == "qwen-mono-router" ]]; then
  if ! command -v aider >/dev/null 2>&1; then
    echo "ERROR: aider not on PATH (pip install aider-chat / pipx install aider-chat)" >&2
    exit 1
  fi
else
  if ! command -v claude >/dev/null 2>&1; then
    echo "ERROR: claude not on PATH (Claude Code CLI required for Token Plan Anthropic-compat)" >&2
    exit 1
  fi
fi

exec "$SCRIPT_DIR/start-swarm.sh" "$@"
