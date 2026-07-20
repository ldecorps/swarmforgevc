#!/usr/bin/env bash
#
# start-swarm-qwen.sh — headless mono-router on Qwen Coding Plan (DashScope).
#
# Pack: qwen-mono-router (pipeline qwen3-coder-plus, coordinator qwen3.5-plus).
# Thin wrapper around ./start-swarm.sh — sources ~/.zshenv, checks prereqs,
# then sets SWARMFORGE_PACK / SWARMFORGE_USE_QWEN and delegates.
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

# Coding Plan keys may also arrive as BAILIAN_CODING_PLAN_API_KEY.
if [[ -z "${QWEN_API_KEY:-}" && -n "${BAILIAN_CODING_PLAN_API_KEY:-}" ]]; then
  export QWEN_API_KEY="$BAILIAN_CODING_PLAN_API_KEY"
fi

if [[ -z "${QWEN_API_KEY:-}" ]]; then
  echo "ERROR: QWEN_API_KEY missing (export or add to ~/.zshenv)" >&2
  exit 1
fi
if ! command -v aider >/dev/null 2>&1; then
  echo "ERROR: aider not on PATH (pip install aider-chat / pipx install aider-chat)" >&2
  exit 1
fi

export SWARMFORGE_USE_QWEN=1
export SWARMFORGE_PACK=qwen-mono-router
exec "$SCRIPT_DIR/start-swarm.sh" "$@"
