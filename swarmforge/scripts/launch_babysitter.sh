#!/usr/bin/env bash
# Launch the always-on Babysitter LLM in its OWN tmux socket (outside the
# swarm chain). Called by start_babysitter.sh.
#
# Uses Claude Code via OpenRouter (same vendor as the mono-router pack).
#
# Usage: launch_babysitter.sh <project-root>
set -euo pipefail

ROOT="${1:?usage: launch_babysitter.sh <project-root>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BB_DIR="$ROOT/.swarmforge/babysitter"
PROMPT="$ROOT/swarmforge/roles/babysitter.prompt"
SETTINGS="$SCRIPT_DIR/babysitter.claude-settings.json"
SESSION="babysitter"
SOCK="$BB_DIR/babysitter-tmux.sock"
MODEL="${BABYSITTER_MODEL:-anthropic/claude-sonnet-5}"
EFFORT="${BABYSITTER_EFFORT:-high}"
KICKOFF="$BB_DIR/babysitter-kickoff.txt"
LAUNCH_SETTINGS="$BB_DIR/babysitter.claude-settings.json"

mkdir -p "$BB_DIR"

# shellcheck disable=SC1090
source "$HOME/.zshenv" 2>/dev/null || true
for env_file in "$ROOT/.swarmforge/openrouter.env" "$HOME/.zshenv"; do
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    source "$env_file" 2>/dev/null || true
  fi
done

unset SWARMFORGE_USE_PERPLEXITY SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_QWEN \
  OPENAI_API_BASE OPENAI_BASE_URL PERPLEXITY_API_KEY || true

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "launch_babysitter: OPENROUTER_API_KEY required (export or .swarmforge/openrouter.env)" >&2
  exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "launch_babysitter: claude not on PATH (Claude Code CLI required)" >&2
  exit 1
fi

# Per-role settings copy with optional model override.
if command -v python3 >/dev/null 2>&1 && [[ -f "$SETTINGS" ]]; then
  python3 - "$SETTINGS" "$LAUNCH_SETTINGS" "$MODEL" "$EFFORT" <<'PY'
import json, sys
src, dst, model, effort = sys.argv[1:5]
with open(src) as f:
    data = json.load(f)
data["model"] = model
data["effortLevel"] = effort
with open(dst, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY
else
  cat > "$LAUNCH_SETTINGS" <<EOF
{
  "model": "${MODEL}",
  "effortLevel": "${EFFORT}",
  "skipDangerousModePermissionPrompt": true,
  "permissions": { "defaultMode": "bypassPermissions" }
}
EOF
fi

if [[ -S "$SOCK" ]]; then
  tmux -S "$SOCK" kill-server 2>/dev/null || true
  rm -f "$SOCK"
fi

cat > "$KICKOFF" <<EOF
You are the SwarmForge Babysitter (OUTSIDE the pipeline).

Project root: $ROOT

DO NOW (use shell — do not ask the human anything):
1) Read $PROMPT (already in system prompt).
2) Run ONE observe pass: sessions, auth, claim-without-progress sidecars, daemons.
3) On BL-528 risk: if git status shows uncommitted work on the claimed role, nudge
   the resident to commit NOW (tmux send-keys). If claim is stale, archive it.
4) Telegram glitches via: node extension/out/tools/notify-babysitter.js --project-root $ROOT --text "..."
5) IDLE at > — the runtime wakes you on handoff, claim-progress risk, or ~20m timer.
EOF

LAUNCH="$BB_DIR/launch.sh"
cat > "$LAUNCH" <<EOF
#!/usr/bin/env zsh
set -uo pipefail
export SWARMFORGE_ROLE=babysitter
export ANTHROPIC_BASE_URL='https://openrouter.ai/api'
unset ANTHROPIC_API_KEY
export ANTHROPIC_AUTH_TOKEN="\$OPENROUTER_API_KEY"
cd '$ROOT'
first=1
while true; do
  if [[ \$first -eq 1 ]]; then
    first=0
    claude --settings '$LAUNCH_SETTINGS' \\
      --dangerously-skip-permissions \\
      --model '$MODEL' \\
      --effort '$EFFORT' \\
      --append-system-prompt-file '$PROMPT' \\
      -n 'Babysitter' \\
      "\$(cat '$KICKOFF')" || true
  else
    echo "[babysitter] claude exited; relaunching idle in 3s..." >&2
    sleep 3
    claude --settings '$LAUNCH_SETTINGS' \\
      --dangerously-skip-permissions \\
      --model '$MODEL' \\
      --effort '$EFFORT' \\
      --append-system-prompt-file '$PROMPT' \\
      -n 'Babysitter' \\
      'Resume babysitter observe duty. Idle at > until the runtime WAKEs you.' || true
  fi
  sleep 2
done
EOF
chmod +x "$LAUNCH"

tmux -S "$SOCK" new-session -d -s "$SESSION" -n Babysitter \
  -e "OPENROUTER_API_KEY=${OPENROUTER_API_KEY}" \
  "zsh '$LAUNCH'"

echo "$SOCK" > "$BB_DIR/socket.path"
echo "$$" > "$BB_DIR/launcher.pid"
tmux -S "$SOCK" list-sessions
echo "Babysitter launched on $SOCK (session $SESSION, model $MODEL via OpenRouter)"
