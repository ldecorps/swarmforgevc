#!/usr/bin/env bash
#
# start-swarm-cursor.sh — headless mono-router with Cursor seats + Opus specifier.
#
# Pack: cursor-mono-router (pipeline Cursor/auto, specifier Claude Opus,
# coordinator Cursor/auto). Thin wrapper around ./start-swarm.sh.
#
# Usage:
#   ./start-swarm-cursor.sh [options] [target-path]   # same flags as start-swarm.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1090
source "$HOME/.zshenv" 2>/dev/null || true
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

unset SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY SWARMFORGE_USE_QWEN OPENAI_API_BASE OPENAI_BASE_URL || true

if [[ -z "${CURSOR_API_KEY:-}" ]]; then
  echo "ERROR: CURSOR_API_KEY missing (export or add to ~/.zshenv)" >&2
  exit 1
fi
if ! command -v cursor-agent >/dev/null 2>&1; then
  echo "ERROR: cursor-agent not on PATH" >&2
  exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "ERROR: claude not on PATH (specifier seat is Claude Opus)" >&2
  exit 1
fi

export SWARMFORGE_PACK=cursor-mono-router
exec "$SCRIPT_DIR/start-swarm.sh" "$@"
