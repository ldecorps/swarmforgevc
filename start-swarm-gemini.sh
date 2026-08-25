#!/usr/bin/env bash
#
# start-swarm-gemini.sh — headless mono-router on Google Gemini CLI.
#
# Pack: gemini-mono-router (pipeline gemini-2.5-pro, coordinator gemini-2.5-flash).
# Thin wrapper around ./start-swarm.sh — sources ~/.zshenv, checks prereqs,
# then sets SWARMFORGE_PACK and delegates.
#
# Usage:
#   ./start-swarm-gemini.sh [options] [target-path]   # same flags as start-swarm.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1090
source "$HOME/.zshenv" 2>/dev/null || true
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

unset SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY SWARMFORGE_USE_QWEN OPENAI_API_BASE OPENAI_BASE_URL || true

if [[ -z "${GEMINI_API_KEY:-${SWARMFORGE_GEMINI_API_KEY:-}}" ]]; then
  echo "ERROR: GEMINI_API_KEY missing (export or add to ~/.zshenv)" >&2
  exit 1
fi
if ! command -v gemini >/dev/null 2>&1; then
  echo "ERROR: gemini not on PATH (npm i -g @google/gemini-cli)" >&2
  exit 1
fi

export SWARMFORGE_PACK=gemini-mono-router
exec "$SCRIPT_DIR/start-swarm.sh" "$@"
