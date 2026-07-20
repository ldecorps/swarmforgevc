#!/usr/bin/env bash
#
# start-swarm-gpt.sh — headless mono-router on OpenAI Codex (GPT).
#
# Pack: codex-mono-router (pipeline gpt-5.5, coordinator gpt-5.4-mini).
# Thin wrapper around ./start-swarm.sh — sources ~/.zshenv, checks prereqs,
# then sets SWARMFORGE_PACK and delegates.
#
# Usage:
#   ./start-swarm-gpt.sh [options] [target-path]   # same flags as start-swarm.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1090
source "$HOME/.zshenv" 2>/dev/null || true
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

unset SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY OPENAI_API_BASE OPENAI_BASE_URL || true

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "ERROR: OPENAI_API_KEY missing (export or add to ~/.zshenv)" >&2
  exit 1
fi
if ! command -v codex >/dev/null 2>&1; then
  echo "ERROR: codex not on PATH (npm i -g @openai/codex)" >&2
  exit 1
fi

export SWARMFORGE_PACK=codex-mono-router
exec "$SCRIPT_DIR/start-swarm.sh" "$@"
