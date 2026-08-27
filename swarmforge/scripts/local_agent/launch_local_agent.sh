#!/usr/bin/env bash
# Launch Local Agent HTTP server (Ollama tool loop for Telegram topic).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
STATE_DIR="${LOCAL_AGENT_STATE_DIR:-$ROOT/.swarmforge/local-agent}"
mkdir -p "$STATE_DIR"

export PATH="${PATH:-}:/mnt/d/dev/ollama/bin"
export OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
export OLLAMA_MODELS="${OLLAMA_MODELS:-/mnt/d/dev/ollama/models}"
export LOCAL_AGENT_ROOT="${LOCAL_AGENT_ROOT:-$ROOT}"
export LOCAL_AGENT_MODEL="${LOCAL_AGENT_MODEL:-hf.co/bartowski/Qwen_Qwen3-14B-GGUF:Q3_K_M}"
export LOCAL_AGENT_THINK="${LOCAL_AGENT_THINK:-false}"
export LOCAL_AGENT_NUM_CTX="${LOCAL_AGENT_NUM_CTX:-2048}"
export LOCAL_AGENT_NUM_PREDICT="${LOCAL_AGENT_NUM_PREDICT:-256}"
export LOCAL_AGENT_KEEP_ALIVE="${LOCAL_AGENT_KEEP_ALIVE:-30m}"
export LOCAL_AGENT_OLLAMA_TIMEOUT="${LOCAL_AGENT_OLLAMA_TIMEOUT:-90}"
export LOCAL_AGENT_TURN_DEADLINE="${LOCAL_AGENT_TURN_DEADLINE:-300}"
export LOCAL_AGENT_TURN_IDLE="${LOCAL_AGENT_TURN_IDLE:-45}"
export LOCAL_AGENT_PORT="${LOCAL_AGENT_PORT:-18765}"
export LOCAL_AGENT_HOST="${LOCAL_AGENT_HOST:-127.0.0.1}"
export LOCAL_AGENT_PRELOAD="${LOCAL_AGENT_PRELOAD:-1}"

PID_FILE="$STATE_DIR/server.pid"
LOG_FILE="$STATE_DIR/server.log"

if [[ -f "$PID_FILE" ]]; then
  old="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old:-}" ]] && kill -0 "$old" 2>/dev/null; then
    echo "local-agent already running pid=$old — restarting"
    kill "$old" 2>/dev/null || true
    sleep 1
    kill -0 "$old" 2>/dev/null && kill -9 "$old" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# Ensure Ollama serve is up
if ! curl -sS -m 2 "http://${OLLAMA_HOST}/" >/dev/null 2>&1; then
  nohup ollama serve >>"$STATE_DIR/ollama-serve.log" 2>&1 &
  sleep 2
fi

# Ensure model present (substring match — HF tags are long)
ollama list 2>/dev/null | grep -Fq "$LOCAL_AGENT_MODEL" || ollama pull "$LOCAL_AGENT_MODEL"

cd "$ROOT"
nohup python3 "$ROOT/swarmforge/scripts/local_agent/server.py" >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
sleep 0.5
if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "local-agent failed to start; see $LOG_FILE" >&2
  exit 1
fi

# Wait briefly for /health
ready=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sS -m 2 "http://${LOCAL_AGENT_HOST}:${LOCAL_AGENT_PORT}/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.3
done

if [[ "$ready" -ne 1 ]]; then
  echo "local-agent started but /health not ready yet; see $LOG_FILE" >&2
  exit 0
fi

echo "local-agent up on http://${LOCAL_AGENT_HOST}:${LOCAL_AGENT_PORT} (model=$LOCAL_AGENT_MODEL think=$LOCAL_AGENT_THINK ctx=$LOCAL_AGENT_NUM_CTX predict=$LOCAL_AGENT_NUM_PREDICT keep_alive=$LOCAL_AGENT_KEEP_ALIVE)"

# Preload model into RAM so the first real Telegram turn is not a 2+ min cold load.
if [[ "$LOCAL_AGENT_PRELOAD" == "1" || "$LOCAL_AGENT_PRELOAD" == "true" ]]; then
  echo "preloading model (keep_alive=$LOCAL_AGENT_KEEP_ALIVE)…"
  ollama_host_url="$OLLAMA_HOST"
  case "$ollama_host_url" in
    *://*) ;;
    *) ollama_host_url="http://${ollama_host_url}" ;;
  esac
  preload_body=$(cat <<EOF
{"model":"$LOCAL_AGENT_MODEL","messages":[{"role":"user","content":"/no_think\nping"}],"stream":false,"think":false,"keep_alive":"$LOCAL_AGENT_KEEP_ALIVE","options":{"num_ctx":$LOCAL_AGENT_NUM_CTX,"num_predict":8}}
EOF
)
  if curl -sS -m 300 "${ollama_host_url}/api/chat" \
      -H 'Content-Type: application/json' \
      -d "$preload_body" >/dev/null; then
    echo "model warm"
  else
    echo "preload failed (agent still up); first chat may be slow" >&2
  fi
fi
exit 0
