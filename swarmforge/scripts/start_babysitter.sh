#!/usr/bin/env bash
# Idempotent start of the Babysitter hawk: Telegram topic + always-on LLM.
#
# Usage: start_babysitter.sh <project-root>
set -euo pipefail

ROOT="${1:?usage: start_babysitter.sh <project-root>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BB_DIR="$ROOT/.swarmforge/babysitter"
LOG="$BB_DIR/babysitter.log"
NOTIFY_JS="$ROOT/extension/out/tools/notify-babysitter.js"

mkdir -p "$BB_DIR"

# Load telegram + perplexity env for topic ensure / notify.
if [[ -f "$ROOT/.swarmforge/perplexity.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$ROOT/.swarmforge/perplexity.env"; set +a
fi
# Common telegram env locations (never commit tokens).
for f in "$HOME/.zshenv" "$ROOT/.swarmforge/telegram.env" "$ROOT/.swarmforge/operator/telegram.env"; do
  if [[ -f "$f" ]]; then
    # shellcheck disable=SC1090
    eval "$(grep -E '^export TELEGRAM_(BOT_TOKEN|CHAT_ID)=' "$f" 2>/dev/null | tail -2)" || true
  fi
done
# Also accept already-exported TELEGRAM_* from the parent shell.
export TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
export TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

if [[ ! -f "$NOTIFY_JS" ]]; then
  echo "start_babysitter: compiling extension (notify-babysitter.js missing)..."
  (cd "$ROOT/extension" && npm run compile) || {
    echo "start_babysitter: compile failed; topic notify may be unavailable" >&2
  }
fi

if [[ -f "$NOTIFY_JS" && -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "Ensuring Babysitter Telegram topic..."
  node "$NOTIFY_JS" --project-root "$ROOT" | tee -a "$LOG" || true
  node "$NOTIFY_JS" --project-root "$ROOT" \
    --text "Babysitter online — watching ${ROOT}. Glitches + remediations land here." \
    | tee -a "$LOG" || true
else
  echo "start_babysitter: skipping Telegram ensure (missing notify js or TELEGRAM_* env)" | tee -a "$LOG"
fi

bash "$SCRIPT_DIR/launch_babysitter.sh" "$ROOT" | tee -a "$LOG"
echo "Babysitter started. Attach: tmux -S $BB_DIR/babysitter-tmux.sock attach -t babysitter"
