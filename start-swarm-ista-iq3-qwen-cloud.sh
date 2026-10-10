#!/usr/bin/env bash
#
# start-swarm-ista-iq3-qwen-cloud.sh — mono-router with local iq3 resident
# and Token Plan qwen cloud coordinator (Claude Code → apps/anthropic).
#
# Pack: ollama-ista-local-model-qwen-coord-mono-router
#
# Usage:
#   ./start-swarm-ista-iq3-qwen-cloud.sh [options] [target-path]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1090
source "$HOME/.zshenv" 2>/dev/null || true
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

unset SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY SWARMFORGE_USE_QWEN OPENAI_API_BASE OPENAI_BASE_URL || true
unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY || true

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

if ! command -v claude >/dev/null 2>&1; then
  echo "ERROR: claude not on PATH (Claude Code CLI required for Token Plan Anthropic-compat)" >&2
  exit 1
fi

if ! command -v qwen >/dev/null 2>&1; then
  echo "ERROR: qwen not on PATH (local-model resident seat)" >&2
  exit 1
fi

if ! curl -sf -m 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "ERROR: ollama not reachable at 127.0.0.1:11434 (need ista-iq3s-coder:latest)" >&2
  exit 1
fi

# Steward resolve-seat has no mapping for local-model + ista-iq3s-coder:latest
# (same hatch as start-swarm-ollama-ista-local-model-claude.sh / swarm.env).
# Pin explicitly — start-swarm.sh's nohup env forward has dropped an empty
# value across the boundary when this was only set inside swarm.env.
export PACK_STAFFING_SKIP_GATE=1
export SWARMFORGE_PACK=ollama-ista-local-model-qwen-coord-mono-router

exec env PACK_STAFFING_SKIP_GATE=1 \
  SWARMFORGE_PACK=ollama-ista-local-model-qwen-coord-mono-router \
  "$SCRIPT_DIR/start-swarm.sh" "$@"
