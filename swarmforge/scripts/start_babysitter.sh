#!/usr/bin/env bash
# Idempotent start of the Babysitter hawk: Telegram topic + LLM + wake runtime.
#
# Usage: start_babysitter.sh <project-root>
set -euo pipefail

ROOT="${1:?usage: start_babysitter.sh <project-root>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BB_DIR="$ROOT/.swarmforge/babysitter"
LOG="$BB_DIR/babysitter.log"
NOTIFY_JS="$ROOT/extension/out/tools/notify-babysitter.js"
RUNTIME_PID="$BB_DIR/runtime.pid"
RUNTIME_LOG="$BB_DIR/runtime.log"

mkdir -p "$BB_DIR"
rm -f "$BB_DIR/stop"
date -u +%Y-%m-%dT%H:%M:%SZ > "$BB_DIR/enabled"

# Load telegram + OpenRouter env for topic ensure / notify / claude launch.
for env_file in \
  "$ROOT/.swarmforge/openrouter.env" \
  "$ROOT/.swarmforge/telegram.env" \
  "$ROOT/.swarmforge/operator/telegram.env"; do
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    set -a; source "$env_file"; set +a
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
    --text "Babysitter online — watching ${ROOT}. Wakes on handoff + ~20m observe." \
    | tee -a "$LOG" || true
else
  echo "start_babysitter: skipping Telegram ensure (missing notify js or TELEGRAM_* env)" | tee -a "$LOG"
fi

bash "$SCRIPT_DIR/launch_babysitter.sh" "$ROOT" | tee -a "$LOG"

# Cheap wake loop: handoff queue + periodic observe (LLM idles between wakes).
if [[ -f "$RUNTIME_PID" ]]; then
  old_pid="$(tr -d '[:space:]' < "$RUNTIME_PID" || true)"
  if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "start_babysitter: runtime already running pid=$old_pid" | tee -a "$LOG"
  else
    rm -f "$RUNTIME_PID"
  fi
fi
if [[ ! -f "$RUNTIME_PID" ]] || ! kill -0 "$(tr -d '[:space:]' < "$RUNTIME_PID")" 2>/dev/null; then
  echo "start_babysitter: starting babysitter_runtime.bb (handoff + 20m timer)" | tee -a "$LOG"
  nohup bb "$SCRIPT_DIR/babysitter_runtime.bb" "$ROOT" >>"$RUNTIME_LOG" 2>&1 &
  echo $! > "$RUNTIME_PID"
  disown || true
fi

echo "Babysitter started. Attach: tmux -S $BB_DIR/babysitter-tmux.sock attach -t babysitter"
echo "Runtime wakes on handoff enqueue and every ~20 minutes."
