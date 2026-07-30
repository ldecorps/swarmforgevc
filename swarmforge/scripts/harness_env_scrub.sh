# harness_env_scrub.sh — BL-657
# Source from bash or zsh. Strips Claude Code / Cursor harness markers so a
# tmux server started by ./swarm or start-swarm.sh does not permanently
# inherit "child session" / transcript-off state from the launching shell.
#
# Keep intentional Claude Code knobs (max output tokens, oauth token).
# Idempotent: safe to call more than once.

# Names unset in the launcher process and cleared from a live tmux server's
# global environment. Keep in sync with harness_env_scrub_lib.bb.
HARNESS_ENV_SCRUB_VARS=(
  CLAUDE_CODE_CHILD_SESSION
  CLAUDECODE
  CLAUDE_CODE_SESSION_ID
  CLAUDE_CODE_SSE_PORT
  CLAUDE_CODE_EXECPATH
  CLAUDE_CODE_ENTRYPOINT
  CURSOR_AGENT
  CURSOR_CONVERSATION_ID
  CURSOR_LAYOUT
  __CURSOR_SANDBOX_ENV_RESTORE
)

scrub_harness_env() {
  local var
  for var in "${HARNESS_ENV_SCRUB_VARS[@]}"; do
    unset "$var" 2>/dev/null || true
  done
}

# Clear the same markers from an already-running tmux server (socket path).
# No-op if the server is not reachable yet.
scrub_tmux_harness_env() {
  local sock="${1:-}"
  [[ -n "$sock" ]] || return 0
  tmux -S "$sock" list-sessions >/dev/null 2>&1 || return 0
  local var
  for var in "${HARNESS_ENV_SCRUB_VARS[@]}"; do
    tmux -S "$sock" set-environment -gu "$var" 2>/dev/null || true
  done
}
