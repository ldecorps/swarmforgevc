#!/usr/bin/env bash
# Launch the always-on Babysitter LLM in its OWN tmux socket (outside the
# swarm chain). Provider follows the active swarm pack.
#
# Usage: launch_babysitter.sh <project-root>
set -euo pipefail

ROOT="${1:?usage: launch_babysitter.sh <project-root>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ancillary_provider_lib.sh
source "$SCRIPT_DIR/ancillary_provider_lib.sh"
ancillary_provider_load "$ROOT"
ancillary_provider_require_credentials

BB_DIR="$ROOT/.swarmforge/babysitter"
PROMPT="$ROOT/swarmforge/roles/babysitter.prompt"
SETTINGS_TEMPLATE="$SCRIPT_DIR/babysitter.claude-settings.json"
SESSION="babysitter"
SOCK="$BB_DIR/babysitter-tmux.sock"
FAMILY="$(ancillary_provider_family)"
MODEL="${BABYSITTER_MODEL:-$(ancillary_provider_default_model babysitter)}"
EFFORT="${BABYSITTER_EFFORT:-high}"
KICKOFF="$BB_DIR/babysitter-kickoff.txt"
LAUNCH_SETTINGS="$BB_DIR/babysitter.claude-settings.json"
LAUNCH="$BB_DIR/launch.sh"
PROVIDER_ENV="$(ancillary_provider_pane_exports)"

mkdir -p "$BB_DIR"

if [[ -S "$SOCK" ]]; then
  tmux -S "$SOCK" kill-server 2>/dev/null || true
  rm -f "$SOCK"
fi

cat > "$KICKOFF" <<EOF
You are the SwarmForge Babysitter (OUTSIDE the pipeline).

Project root: $ROOT

DO NOW (use shell — do not ask the human anything):
1) Read $PROMPT (already in system prompt where supported).
2) Run ONE observe pass: sessions, auth, claim-without-progress sidecars, daemons.
3) On BL-528 risk: if git status shows uncommitted work on the claimed role, nudge
   the resident via babysitter_nudge_resident.bb (verified inject — never raw
   tmux send-keys). If claim is stale, archive it.
4) Telegram glitches via: node extension/out/tools/notify-babysitter.js --project-root $ROOT --text "..."
5) IDLE at > — the runtime wakes you on handoff, claim-progress risk, or ~20m timer.
EOF

case "$FAMILY" in
  openrouter|claude_direct)
    if [[ "$FAMILY" == openrouter ]]; then
      ancillary_provider_write_claude_settings "$SETTINGS_TEMPLATE" "$LAUNCH_SETTINGS" "$MODEL" "$EFFORT"
    else
      cp "$SETTINGS_TEMPLATE" "$LAUNCH_SETTINGS"
    fi
    cat > "$LAUNCH" <<EOF
#!/usr/bin/env zsh
set -uo pipefail
export SWARMFORGE_ROLE=babysitter
${PROVIDER_ENV}
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
      -n Babysitter \\
      "\$(cat '$KICKOFF')" || true
  else
    echo "[babysitter] claude exited; relaunching idle in 3s..." >&2
    sleep 3
    claude --settings '$LAUNCH_SETTINGS' \\
      --dangerously-skip-permissions \\
      --model '$MODEL' \\
      --effort '$EFFORT' \\
      --append-system-prompt-file '$PROMPT' \\
      -n Babysitter \\
      'Resume babysitter observe duty. Idle at > until the runtime WAKEs you.' || true
  fi
  sleep 2
done
EOF
    ;;
  gemini)
    cat > "$LAUNCH" <<EOF
#!/usr/bin/env zsh
set -uo pipefail
export SWARMFORGE_ROLE=babysitter
${PROVIDER_ENV}
cd '$ROOT'
first=1
while true; do
  if [[ \$first -eq 1 ]]; then
    first=0
    gemini -y -m '$MODEL' -p "\$(cat '$KICKOFF')" || true
  else
    echo "[babysitter] gemini exited; relaunching idle in 3s..." >&2
    sleep 3
    gemini -y -m '$MODEL' -p 'Resume babysitter observe duty. Idle at > until the runtime WAKEs you.' || true
  fi
  sleep 2
done
EOF
    ;;
  codex)
    cat > "$LAUNCH" <<EOF
#!/usr/bin/env zsh
set -uo pipefail
export SWARMFORGE_ROLE=babysitter
${PROVIDER_ENV}
cd '$ROOT'
first=1
while true; do
  if [[ \$first -eq 1 ]]; then
    first=0
    codex -m '$MODEL' "\$(cat '$KICKOFF')" || true
  else
    echo "[babysitter] codex exited; relaunching idle in 3s..." >&2
    sleep 3
    codex -m '$MODEL' 'Resume babysitter observe duty. Idle at > until the runtime WAKEs you.' || true
  fi
  sleep 2
done
EOF
    ;;
  openai_aider)
    cat > "$LAUNCH" <<EOF
#!/usr/bin/env zsh
set -uo pipefail
export SWARMFORGE_ROLE=babysitter
${PROVIDER_ENV}
cd '$ROOT'
first=1
while true; do
  if [[ \$first -eq 1 ]]; then
    first=0
    aider --yes --no-git --model '$MODEL' --message "\$(cat '$KICKOFF')" || true
  else
    echo "[babysitter] aider exited; relaunching idle in 3s..." >&2
    sleep 3
    aider --yes --no-git --model '$MODEL' --message 'Resume babysitter observe duty. Idle at > until the runtime WAKEs you.' || true
  fi
  sleep 2
done
EOF
    ;;
  *)
    echo "launch_babysitter: unsupported provider family $FAMILY" >&2
    exit 1
    ;;
esac
chmod +x "$LAUNCH"

ancillary_provider_fill_tmux_env
tmux -S "$SOCK" new-session -d -s "$SESSION" -n Babysitter \
  "${ANCILLARY_TMUX_ENV[@]}" \
  "zsh '$LAUNCH'"

echo "$SOCK" > "$BB_DIR/socket.path"
echo "$$" > "$BB_DIR/launcher.pid"
tmux -S "$SOCK" list-sessions
echo "Babysitter launched on $SOCK (pack=$(ancillary_provider_pack) provider=$FAMILY model=$MODEL)"
