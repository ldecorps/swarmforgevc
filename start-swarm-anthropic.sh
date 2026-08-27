#!/usr/bin/env bash
#
# start-swarm-anthropic.sh — headless mono-router on OpenRouter (Anthropic only).
#
# Pack: openrouter-anthropic-mono-router
#   specifier / coder / architect / QA / hardender → anthropic/claude-sonnet-5
#   coordinator / cleaner / documenter → anthropic/claude-haiku-4.5
#
# Thin wrapper around ./start-swarm.sh — sources ~/.zshenv, checks prereqs,
# then sets SWARMFORGE_PACK and delegates (.swarmforge/openrouter.env is
# sourced by start-swarm.sh from the target path).
#
# Usage:
#   ./start-swarm-anthropic.sh [options] [target-path]   # same flags as start-swarm.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1090
source "$HOME/.zshenv" 2>/dev/null || true
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

unset SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY SWARMFORGE_USE_QWEN OPENAI_API_BASE OPENAI_BASE_URL || true

if [[ -f "$SCRIPT_DIR/.swarmforge/openrouter.env" ]]; then
  # shellcheck disable=SC1090
  source "$SCRIPT_DIR/.swarmforge/openrouter.env"
fi

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "ERROR: OPENROUTER_API_KEY missing (export or add to ~/.zshenv)" >&2
  exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "ERROR: claude not on PATH (Claude Code CLI required for OpenRouter routing)" >&2
  exit 1
fi

export SWARMFORGE_PACK=openrouter-anthropic-mono-router
exec "$SCRIPT_DIR/start-swarm.sh" "$@"
