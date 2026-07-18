#!/usr/bin/env bash
# Manual Cerebras→GPT pack switch until BL-525 automates this.
set -euo pipefail
ROOT="${1:-$(pwd)}"
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"
# shellcheck disable=SC1090
source "$HOME/.zshenv" 2>/dev/null || true
unset SWARMFORGE_USE_CEREBRAS || true
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY missing" >&2
  exit 1
fi
bash "$ROOT/swarmforge/scripts/kill_all_swarm.sh" "$ROOT" || true
sleep 2
export SWARMFORGE_TERMINAL=none SWARMFORGE_SKIP_OPERATOR=1 SWARMFORGE_SKIP_FRONT_DESK=1
exec "$ROOT/swarm" "$ROOT" --pack codex-mono-router
