#!/usr/bin/env bash
#
# start-swarm-mistral.sh — headless mono-router on Mistral Vibe.
#
# Pack: vibe-mono-router (one resident Vibe agent + Vibe coordinator).
# Thin wrapper around ./start-swarm.sh — sources ~/.zshenv, checks prereqs,
# then sets SWARMFORGE_PACK and delegates.
#
# Usage:
#   ./start-swarm-mistral.sh [options] [target-path]   # same flags as start-swarm.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1090
source "$HOME/.zshenv" 2>/dev/null || true
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

unset SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY OPENAI_API_BASE OPENAI_BASE_URL || true

if [[ -z "${MISTRAL_API_KEY:-}" ]]; then
  echo "ERROR: MISTRAL_API_KEY missing (export or add to ~/.zshenv)" >&2
  exit 1
fi
if ! command -v vibe >/dev/null 2>&1; then
  echo "ERROR: vibe not on PATH (pipx install mistral-vibe)" >&2
  exit 1
fi

export SWARMFORGE_PACK=vibe-mono-router
exec "$SCRIPT_DIR/start-swarm.sh" "$@"
