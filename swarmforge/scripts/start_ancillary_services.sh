#!/usr/bin/env bash
# Start operator runtime, Telegram front desk, babysitter, and remote tunnels.
#
# Best-effort: a failed ancillary must never abort an otherwise successful swarm
# launch. Pair with `./swarm ensure` for idempotent repair.
#
# Usage: start_ancillary_services.sh [repo-root]
#
# Env (same as swarmforge.sh):
#   SWARMFORGE_SKIP_OPERATOR=1
#   SWARMFORGE_SKIP_FRONT_DESK=1
#   SWARMFORGE_SKIP_BABYSITTER=1
#   SWARMFORGE_SKIP_TUNNEL=1
#   SWARMFORGE_SKIP_RESIDENT_SPY_TUNNEL=1
set -euo pipefail

ROOT="$(cd "${1:-.}" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$ROOT/.swarmforge/swarm.env" ]]; then
  # shellcheck disable=SC1090
  source "$ROOT/.swarmforge/swarm.env"
fi

# shellcheck disable=SC1090
source "$HOME/.zshenv" 2>/dev/null || true
for env_file in \
  "$ROOT/.swarmforge/perplexity.env" \
  "$ROOT/.swarmforge/telegram.env" \
  "$ROOT/.swarmforge/qwen.env" \
  "$ROOT/.swarmforge/openrouter.env"; do
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    source "$env_file"
  fi
done

export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if [[ "${SWARMFORGE_SKIP_OPERATOR:-}" == "1" ]]; then
  echo "Skipping operator runtime (SWARMFORGE_SKIP_OPERATOR=1)."
else
  echo "Starting operator runtime..."
  if ! bash "$SCRIPT_DIR/start_operator_runtime.sh" "$ROOT"; then
    echo "WARN: operator runtime failed to start; run './swarm ensure' after fixing." >&2
  fi
fi

if [[ "${SWARMFORGE_SKIP_FRONT_DESK:-}" == "1" ]]; then
  echo "Skipping Telegram front desk (SWARMFORGE_SKIP_FRONT_DESK=1)."
elif [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" && -n "${TELEGRAM_PRINCIPAL_USER_ID:-}" ]]; then
  echo "Starting Telegram front desk (bridge + bot)..."
  if ! bash "$SCRIPT_DIR/launch_front_desk.sh" "$ROOT"; then
    echo "WARN: front desk failed to start; run './swarm ensure' after fixing." >&2
  fi
else
  echo "Telegram front desk skipped (set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_PRINCIPAL_USER_ID)."
fi

if [[ "${SWARMFORGE_SKIP_BABYSITTER:-}" == "1" ]]; then
  echo "Skipping babysitter (SWARMFORGE_SKIP_BABYSITTER=1)."
elif [[ -f "$SCRIPT_DIR/start_babysitter.sh" ]]; then
  echo "Starting babysitter..."
  if ! bash "$SCRIPT_DIR/start_babysitter.sh" "$ROOT"; then
    echo "WARN: babysitter failed to start." >&2
  fi
fi

if [[ "${SWARMFORGE_SKIP_TUNNEL:-}" == "1" ]]; then
  echo "Skipping vscode tunnel (SWARMFORGE_SKIP_TUNNEL=1)."
elif [[ -f "$SCRIPT_DIR/operator_tunnel.sh" ]]; then
  bash "$SCRIPT_DIR/operator_tunnel.sh" ensure "$ROOT" || \
    echo "WARN: vscode tunnel ensure failed." >&2
fi

if [[ "${SWARMFORGE_SKIP_RESIDENT_SPY_TUNNEL:-}" == "1" ]]; then
  :
elif [[ -f "$SCRIPT_DIR/launch_resident_spy_tunnel.sh" ]]; then
  bash "$SCRIPT_DIR/launch_resident_spy_tunnel.sh" "$ROOT" || \
    echo "WARN: resident spy tunnel launch failed." >&2
fi
