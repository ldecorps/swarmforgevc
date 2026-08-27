# harness_env_scrub.sh — BL-657 (harness markers), BL-1049 (provider secrets)
# Source from bash or zsh. Strips Claude Code / Cursor harness markers so a
# tmux server started by ./swarm or start-swarm.sh does not permanently
# inherit "child session" / transcript-off state from the launching shell.
#
# Keep intentional Claude Code knobs (max output tokens, oauth token).
# Idempotent: safe to call more than once.
#
# BL-1049: `tmux new-session` seeds the SERVER's global environment from the
# whole calling shell, so every pane opened afterwards inherits a copy of
# every API key that shell exported. The tmux-server scrub therefore also
# removes provider secrets, minus a keep-list DERIVED from the running
# configuration's own window backends. The LAUNCHER-process scrub does not:
# start_handoff_daemon forks handoffd with plain nohup after it runs, and
# handoffd reads RESEND_API_KEY for briefing email from that inherited env.
# The two lists are separate on purpose and must stay separate.
#
# Keep in sync with harness_env_scrub_lib.bb - both halves. A name one side
# scrubs and the other does not is a silent hole between the live launcher
# and the diagnostic CLI; bl1049_provider_env_scrub_test_runner.bb asserts
# the two files agree.

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

# BL-1049: credential-shaped names observed in the live server's global
# environment. Cleared from the tmux SERVER only, never from the launcher
# process. Keep in sync with harness_env_scrub_lib.bb's provider-secret-vars.
HARNESS_ENV_PROVIDER_SECRET_VARS=(
BAILIAN_API_KEY
BAILIAN_CODING_PLAN_API_KEY
BAILIAN_TOKEN_PLAN_API_KEY
CEREBRAS_API_KEY
CURSOR_API_KEY
DASHSCOPE_API_KEY
DEEPSEEK_API_KEY
GEMINI_API_KEY
MISTRAL_API_KEY
OPENAI_API_KEY
OPENROUTER_API_KEY
PERPLEXITY_API_KEY
QWEN_API_KEY
RESEND_API_KEY
TELEGRAM_BOT_TOKEN
)

# Directory this library was sourced from, so the default conf can be found
# from either caller (swarmforge/scripts/swarmforge.sh under zsh, the repo
# root's start-swarm.sh under bash). zsh has no BASH_SOURCE.
if [ -n "${ZSH_VERSION:-}" ]; then
  HARNESS_ENV_SCRUB_SELF_DIR="${0:A:h}"
else
  HARNESS_ENV_SCRUB_SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

scrub_harness_env() {
  local var
  for var in ${HARNESS_ENV_SCRUB_VARS[@]+"${HARNESS_ENV_SCRUB_VARS[@]}"}; do
    unset "$var" 2>/dev/null || true
  done
}

# BL-1049: what one window backend reads. Mirrors harness_env_scrub_lib.bb's
# backend-provider-vars; `openrouter` is the SWARMFORGE_OPENROUTER_ROLES env
# gate rather than a conf backend. A backend NOT listed here deliberately
# falls through to "needs everything" in harness_env_provider_scrub_vars -
# an unrecognised backend costs the swarm its leak, never its credentials.
harness_env_backend_provider_vars() {
  case "$1" in
    claude) printf '%s\n'  ;;
    copilot) printf '%s\n'  ;;
    grok) printf '%s\n'  ;;
    codex) printf '%s\n' OPENAI_API_KEY ;;
    gemini) printf '%s\n' GEMINI_API_KEY ;;
    vibe) printf '%s\n' MISTRAL_API_KEY ;;
    local-model) printf '%s\n' OPENAI_API_KEY ;;
    openrouter) printf '%s\n' OPENROUTER_API_KEY ;;
    aider) printf '%s\n' OPENAI_API_KEY MISTRAL_API_KEY CEREBRAS_API_KEY PERPLEXITY_API_KEY QWEN_API_KEY DASHSCOPE_API_KEY DEEPSEEK_API_KEY BAILIAN_API_KEY BAILIAN_CODING_PLAN_API_KEY BAILIAN_TOKEN_PLAN_API_KEY ;;
    *) return 1 ;;
  esac
}

# The swarmforge.conf whose window lines define the keep-list. Prefers the
# explicit test seam, then the launcher's own resolved CONFIG_FILE (which
# already honours SWARMFORGE_CONFIG and --pack), then the default beside
# this library. Prints nothing when none exists.
harness_env_scrub_conf_path() {
  local candidate
  for candidate in "${SWARMFORGE_ENV_SCRUB_CONF:-}" "${CONFIG_FILE:-}" \
                   "${SWARMFORGE_CONFIG:-}" "$HARNESS_ENV_SCRUB_SELF_DIR/../swarmforge.conf"; do
    [ -n "$candidate" ] || continue
    case "$candidate" in
      /*) ;;
      *) candidate="${WORKING_DIR:-$PWD}/$candidate" ;;
    esac
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

# Window backends the running configuration declares, one per line. Adds the
# `openrouter` pseudo-backend when SWARMFORGE_OPENROUTER_ROLES routes any
# claude role through OpenRouter. Empty output means "configuration unknown".
harness_env_configured_backends() {
  local conf
  conf="$(harness_env_scrub_conf_path)" || return 0
  awk '$1 == "window" && NF >= 3 { print $3 }' "$conf" 2>/dev/null | sort -u
  if [ -n "${SWARMFORGE_OPENROUTER_ROLES:-}" ]; then
    printf '%s\n' openrouter
  fi
}

# The provider secrets this configuration's tmux server must not carry, one
# per line. Empty when the configuration could not be read at all: that is
# not evidence nothing needs a key, so it scrubs nothing and leaves the leak
# rather than cutting a configured provider's credentials.
harness_env_provider_scrub_vars() {
  local backends keep var backend
  backends="$(harness_env_configured_backends)"
  [ -n "$backends" ] || return 0

  # `while read`, never `for backend in $backends`: this library is sourced by
  # BOTH shells, and zsh does not word-split an unquoted parameter (SH_WORD_SPLIT
  # is off by default). Under zsh that loop ran ONCE with every backend name
  # glued into a single token, which no case arm matches, so the whole scrub
  # silently failed open on the real launcher while every bash test passed.
  keep=""
  while IFS= read -r backend; do
    [ -n "$backend" ] || continue
    if ! harness_env_backend_provider_vars "$backend" >/dev/null 2>&1; then
      # Unknown backend: keep everything (invariant 2).
      return 0
    fi
    keep="$keep
$(harness_env_backend_provider_vars "$backend")"
  done <<EOF
$backends
EOF

  for var in ${HARNESS_ENV_PROVIDER_SECRET_VARS[@]+"${HARNESS_ENV_PROVIDER_SECRET_VARS[@]}"}; do
    case "
$keep
" in
      *"
$var
"*) ;;
      *) printf '%s\n' "$var" ;;
    esac
  done
}

# Clear the harness markers, and the provider secrets this configuration does
# not need, from an already-running tmux server (socket path). No-op, exit 0,
# if the server is not reachable yet.
scrub_tmux_harness_env() {
  local sock="${1:-}"
  [ -n "$sock" ] || return 0
  tmux -S "$sock" list-sessions >/dev/null 2>&1 || return 0
  local var
  for var in ${HARNESS_ENV_SCRUB_VARS[@]+"${HARNESS_ENV_SCRUB_VARS[@]}"}; do
    tmux -S "$sock" set-environment -gu "$var" 2>/dev/null || true
  done
  # Same reason as above: read line by line rather than relying on either
  # shell's word-splitting rules for a substitution.
  while IFS= read -r var; do
    [ -n "$var" ] || continue
    tmux -S "$sock" set-environment -gu "$var" 2>/dev/null || true
  done <<EOF
$(harness_env_provider_scrub_vars)
EOF
}
