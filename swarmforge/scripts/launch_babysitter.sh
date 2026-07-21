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
KICKOFF="$BB_DIR/babysitter-kickoff.txt"

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
# Aider --yes-always auto-opens billing/docs URLs from API errors; never do that
# in the headless babysitter pane (was spamming perplexity.ai/settings/api).
export BROWSER="${BROWSER:-/usr/bin/true}"

# Kill prior session on this socket (idempotent restart).
if [[ -S "$SOCK" ]]; then
  tmux -S "$SOCK" kill-server 2>/dev/null || true
  rm -f "$SOCK"
fi

# Imperative kickoff — same posture as Operator: act, don't chat about files.
cat > "$KICKOFF" <<EOF
You are the SwarmForge Babysitter (OUTSIDE the pipeline). This is NOT a code-edit
chat and NOT an "add files to the chat" session.

Project root: $ROOT
Role prompt: $PROMPT

DO NOW (use shell with ! — do not ask the human anything):
1) Read $PROMPT fully (it is already --file'd; or ! cat it).
2) Run ONE observe pass from the prompt (tmux sessions under .swarmforge/tmux,
   auth errors in panes, handoffd heartbeat, claim-without-progress).
3) If anything is wrong: remediate minimally OR file a backlog defect + notify
   Telegram via: ! node extension/out/tools/notify-babysitter.js --project-root $ROOT --text "..."
4) Then IDLE at the > prompt. Do NOT self-sleep loops. Do NOT propose files to add.
   A cheap runtime will WAKE you on handoff delivery and ~every 20 minutes.
EOF

LAUNCH="$BB_DIR/launch.sh"
# Stay-alive loop: aider sometimes exits after kickoff / API blips; the
# babysitter runtime expects a living pane to inject WAKE text into. Without
# the loop, runtime logs "llm-down relaunching" every cycle and observe never
# sticks. Kickoff (--message-file) only on first start; restarts idle at >.
cat > "$LAUNCH" <<EOF
#!/usr/bin/env zsh
set -uo pipefail
export SWARMFORGE_ROLE=babysitter
export SWARMFORGE_USE_PERPLEXITY=1
export OPENAI_API_KEY="\$PERPLEXITY_API_KEY"
export OPENAI_API_BASE=https://api.perplexity.ai
export OPENAI_BASE_URL=https://api.perplexity.ai
export BROWSER="\${BROWSER:-/usr/bin/true}"
cd '$ROOT'
# Re-apply remap after zshenv may re-export host OPENAI (BL-535 / SRE).
if [[ -n "\${PERPLEXITY_API_KEY:-}" ]]; then
  export OPENAI_API_KEY="\$PERPLEXITY_API_KEY"
fi
first=1
while true; do
  if [[ \$first -eq 1 ]]; then
    first=0
    aider --model $MODEL \\
      --openai-api-base https://api.perplexity.ai \\
      --no-gitignore --no-show-model-warnings --no-check-update --yes-always --no-detect-urls \\
      --file '$PROMPT' \\
      --message-file '$KICKOFF' || true
  else
    echo "[babysitter] aider exited; relaunching idle in 3s..." >&2
    sleep 3
    aider --model $MODEL \\
      --openai-api-base https://api.perplexity.ai \\
      --no-gitignore --no-show-model-warnings --no-check-update --yes-always --no-detect-urls \\
      --file '$PROMPT' || true
  fi
  sleep 2
done
EOF
chmod +x "$LAUNCH"

tmux -S "$SOCK" new-session -d -s "$SESSION" -n Babysitter \
  -e "PERPLEXITY_API_KEY=${PERPLEXITY_API_KEY}" \
  -e "SWARMFORGE_USE_PERPLEXITY=1" \
  -e "OPENAI_API_KEY=${PERPLEXITY_API_KEY}" \
  -e "OPENAI_API_BASE=https://api.perplexity.ai" \
  -e "OPENAI_BASE_URL=https://api.perplexity.ai" \
  -e "BROWSER=${BROWSER:-/usr/bin/true}" \
  "zsh '$LAUNCH'"

echo "$SOCK" > "$BB_DIR/socket.path"
echo "$$" > "$BB_DIR/launcher.pid"
tmux -S "$SOCK" list-sessions
echo "Babysitter launched on $SOCK (session $SESSION, model $MODEL)"
