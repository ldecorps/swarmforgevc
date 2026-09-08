#!/usr/bin/env bash
#
# start-swarm-glm.sh — headless mono-router on the b.ai gateway (BL-1495).
#
# Default pack: glm-mono-router (aider OpenAI-compat coordinator/workers on
# tencentcloud2/glm-5.3-flash; Claude Code specifier on claude-fable-5-1).
#
# Usage:
#   ./start-swarm-glm.sh [options] [target-path]   # same flags as start-swarm.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1090
source "$HOME/.zshenv" 2>/dev/null || true
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

unset SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY SWARMFORGE_USE_QWEN OPENAI_API_BASE OPENAI_BASE_URL || true

if [[ -z "${B_AI_API_KEY:-}" ]]; then
  echo "ERROR: B_AI_API_KEY missing (export or ~/.zshenv)" >&2
  exit 1
fi

export SWARMFORGE_USE_BAI=1
export SWARMFORGE_PACK="${SWARMFORGE_PACK:-glm-mono-router}"

if ! command -v aider >/dev/null 2>&1; then
  echo "ERROR: aider not on PATH (pip install aider-chat / pipx install aider-chat)" >&2
  exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "ERROR: claude not on PATH (Claude Code CLI required for the specifier seat)" >&2
  exit 1
fi

exec "$SCRIPT_DIR/start-swarm.sh" "$@"
