#!/usr/bin/env bash
# Launch the always-on Babysitter LLM in its OWN tmux socket (outside the
# swarm chain). Called by start_babysitter.sh.
#
# Usage: launch_babysitter.sh <project-root>
set -euo pipefail

ROOT="${1:?usage: launch_babysitter.sh <project-root>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BB_DIR="$ROOT/.swarmforge/babysitter"
PROMPT="$ROOT/swarmforge/roles/babysitter.prompt"
SESSION="babysitter"
SOCK="$BB_DIR/babysitter-tmux.sock"
MODEL="${BABYSITTER_MODEL:-openai/sonar-reasoning-pro}"

mkdir -p "$BB_DIR"

# Keys: same Perplexity posture as the mono-router pack.
if [[ -f "$ROOT/.swarmforge/perplexity.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$ROOT/.swarmforge/perplexity.env"; set +a
fi
if [[ -z "${PERPLEXITY_API_KEY:-}" && -f "${HOME}/.zshenv" ]]; then
  # shellcheck disable=SC1090
  eval "$(grep -E '^export PERPLEXITY_API_KEY=' "${HOME}/.zshenv" | tail -1)"
  export PERPLEXITY_API_KEY
fi
export SWARMFORGE_USE_PERPLEXITY="${SWARMFORGE_USE_PERPLEXITY:-1}"
if [[ -z "${PERPLEXITY_API_KEY:-}" ]]; then
  echo "launch_babysitter: PERPLEXITY_API_KEY required" >&2
  exit 1
fi
export OPENAI_API_KEY="$PERPLEXITY_API_KEY"
export OPENAI_API_BASE=https://api.perplexity.ai
export OPENAI_BASE_URL=https://api.perplexity.ai

# Kill prior session on this socket (idempotent restart).
if [[ -S "$SOCK" ]]; then
  tmux -S "$SOCK" kill-server 2>/dev/null || true
  rm -f "$SOCK"
fi

LAUNCH="$BB_DIR/launch.sh"
cat > "$LAUNCH" <<EOF
#!/usr/bin/env zsh
set -euo pipefail
export SWARMFORGE_ROLE=babysitter
export SWARMFORGE_USE_PERPLEXITY=1
export OPENAI_API_KEY="\$PERPLEXITY_API_KEY"
export OPENAI_API_BASE=https://api.perplexity.ai
export OPENAI_BASE_URL=https://api.perplexity.ai
cd '$ROOT'
# Re-apply remap after zshenv may re-export host OPENAI (BL-535 / SRE).
if [[ -n "\${PERPLEXITY_API_KEY:-}" ]]; then
  export OPENAI_API_KEY="\$PERPLEXITY_API_KEY"
fi
exec aider --model $MODEL \\
  --openai-api-base https://api.perplexity.ai \\
  --no-gitignore --no-show-model-warnings --no-check-update --yes-always \\
  --message "You are the SwarmForge Babysitter (outside the pipeline). Read $PROMPT completely and begin your observe loop. Project root: $ROOT"
EOF
chmod +x "$LAUNCH"

tmux -S "$SOCK" new-session -d -s "$SESSION" -n Babysitter \
  -e "PERPLEXITY_API_KEY=${PERPLEXITY_API_KEY}" \
  -e "SWARMFORGE_USE_PERPLEXITY=1" \
  -e "OPENAI_API_KEY=${PERPLEXITY_API_KEY}" \
  -e "OPENAI_API_BASE=https://api.perplexity.ai" \
  -e "OPENAI_BASE_URL=https://api.perplexity.ai" \
  "zsh '$LAUNCH'"

echo "$SOCK" > "$BB_DIR/socket.path"
echo "$$" > "$BB_DIR/launcher.pid"
tmux -S "$SOCK" list-sessions
echo "Babysitter launched on $SOCK (session $SESSION, model $MODEL)"
