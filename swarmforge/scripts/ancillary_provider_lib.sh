#!/usr/bin/env bash
# Pack-aware LLM provider routing for ancillary launchers (Operator, Concierge,
# Babysitter). Resolves the active swarm pack from SWARMFORGE_PACK or
# .swarmforge/swarm-identity, then routes EVERY ancillary LLM through that
# pack's vendor — never a fallback to a different provider the operator may
# have exhausted.
#
# Usage (source only):
#   source "$SCRIPT_DIR/ancillary_provider_lib.sh"
#   ancillary_provider_load "$ROOT"
#   ancillary_provider_require_credentials
#   echo "family=$(ancillary_provider_family) pack=$(ancillary_provider_pack)"
set -euo pipefail

ANCILLARY_PROVIDER_PACK=""
ANCILLARY_PROVIDER_FAMILY=""
ANCILLARY_PROVIDER_CONF_PATH=""
ANCILLARY_PROVIDER_LOADED=0

ancillary_provider_resolve_pack() {
  local root="${1:?}"
  if [[ -n "${SWARMFORGE_PACK:-}" ]]; then
    printf '%s\n' "$SWARMFORGE_PACK"
    return 0
  fi
  local identity="$root/.swarmforge/swarm-identity"
  if [[ -f "$identity" ]]; then
    local conf_path
    conf_path="$(awk -F'\t' '$1=="active_backlog_max_depth_conf_path"{print $2; exit}' "$identity")"
    if [[ -n "$conf_path" && -f "$conf_path" ]]; then
      ANCILLARY_PROVIDER_CONF_PATH="$conf_path"
      basename "$conf_path" .conf
      return 0
    fi
  fi
  printf '%s\n' ""
}

ancillary_provider_family_for_pack() {
  local pack="$1"
  case "$pack" in
    openrouter-*|*-openrouter*) printf '%s\n' openrouter ;;
    gemini-*) printf '%s\n' gemini ;;
    codex-*) printf '%s\n' codex ;;
    perplexity-*|qwen-*|cerebras-*|vibe-*) printf '%s\n' openai_aider ;;
    mono-router) printf '%s\n' claude_direct ;;
    *)
      if [[ "$pack" == *gemini* ]]; then printf '%s\n' gemini
      elif [[ "$pack" == *codex* ]]; then printf '%s\n' codex
      elif [[ "$pack" == *openrouter* ]]; then printf '%s\n' openrouter
      elif [[ "$pack" == *perplexity* || "$pack" == *qwen* || "$pack" == *cerebras* || "$pack" == *vibe* ]]; then
        printf '%s\n' openai_aider
      else
        printf '%s\n' claude_direct
      fi
      ;;
  esac
}

ancillary_provider_source_env_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    # shellcheck disable=SC1090
    source "$file" 2>/dev/null || true
  fi
}

ancillary_provider_load() {
  local root="${1:?ancillary_provider_load: root required}"
  # shellcheck disable=SC1090
  source "$HOME/.zshenv" 2>/dev/null || true

  ANCILLARY_PROVIDER_PACK="$(ancillary_provider_resolve_pack "$root")"
  if [[ -z "$ANCILLARY_PROVIDER_CONF_PATH" && -f "$root/.swarmforge/swarm-identity" ]]; then
    ANCILLARY_PROVIDER_CONF_PATH="$(awk -F'\t' '$1=="active_backlog_max_depth_conf_path"{print $2; exit}' "$root/.swarmforge/swarm-identity")"
  fi
  ANCILLARY_PROVIDER_FAMILY="$(ancillary_provider_family_for_pack "${ANCILLARY_PROVIDER_PACK:-}")"

  case "$ANCILLARY_PROVIDER_FAMILY" in
    openrouter)
      ancillary_provider_source_env_file "$root/.swarmforge/openrouter.env"
      ;;
    gemini)
      if [[ -z "${GEMINI_API_KEY:-}" && -n "${SWARMFORGE_GEMINI_API_KEY:-}" ]]; then
        export GEMINI_API_KEY="$SWARMFORGE_GEMINI_API_KEY"
      fi
      ;;
    codex)
      : # OPENAI_API_KEY from zshenv
      ;;
    openai_aider)
      ancillary_provider_source_env_file "$root/.swarmforge/perplexity.env"
      ancillary_provider_source_env_file "$root/.swarmforge/qwen.env"
      if [[ -z "${QWEN_API_KEY:-}" && -n "${BAILIAN_TOKEN_PLAN_API_KEY:-}" ]]; then
        export QWEN_API_KEY="$BAILIAN_TOKEN_PLAN_API_KEY"
      fi
      if [[ -z "${QWEN_API_KEY:-}" && -n "${BAILIAN_CODING_PLAN_API_KEY:-}" ]]; then
        export QWEN_API_KEY="$BAILIAN_CODING_PLAN_API_KEY"
      fi
      case "$ANCILLARY_PROVIDER_PACK" in
        perplexity-*) export SWARMFORGE_USE_PERPLEXITY=1 ;;
        qwen-*) export SWARMFORGE_USE_QWEN=1 ;;
        cerebras-*) export SWARMFORGE_USE_CEREBRAS=1 ;;
      esac
      ;;
    claude_direct)
      : # direct Claude subscription — no third-party routing keys
      ;;
  esac

  # Never let a stale cross-vendor key from the shell hijack a different pack.
  case "$ANCILLARY_PROVIDER_FAMILY" in
    openrouter)
      ;;
    gemini)
      unset OPENROUTER_API_KEY ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN || true
      ;;
    codex)
      unset OPENROUTER_API_KEY ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN GEMINI_API_KEY || true
      ;;
    openai_aider)
      unset OPENROUTER_API_KEY ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN GEMINI_API_KEY || true
      ;;
    claude_direct)
      unset OPENROUTER_API_KEY ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN GEMINI_API_KEY || true
      ;;
  esac

  unset SWARMFORGE_USE_PERPLEXITY SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_QWEN \
    OPENAI_API_BASE OPENAI_BASE_URL PERPLEXITY_API_KEY 2>/dev/null || true
  case "$ANCILLARY_PROVIDER_FAMILY" in
    openai_aider)
      case "$ANCILLARY_PROVIDER_PACK" in
        perplexity-*) export SWARMFORGE_USE_PERPLEXITY=1 ;;
        qwen-*) export SWARMFORGE_USE_QWEN=1 ;;
        cerebras-*) export SWARMFORGE_USE_CEREBRAS=1 ;;
      esac
      ;;
  esac

  ANCILLARY_PROVIDER_LOADED=1
}

ancillary_provider_pack() { printf '%s\n' "${ANCILLARY_PROVIDER_PACK:-}"; }
ancillary_provider_family() { printf '%s\n' "${ANCILLARY_PROVIDER_FAMILY:-}"; }

ancillary_provider_require_credentials() {
  [[ "${ANCILLARY_PROVIDER_LOADED:-0}" == 1 ]] || {
    echo "ancillary_provider: call ancillary_provider_load first" >&2
    return 1
  }
  case "$ANCILLARY_PROVIDER_FAMILY" in
    openrouter)
      [[ -n "${OPENROUTER_API_KEY:-}" ]] || {
        echo "ancillary_provider: pack $(ancillary_provider_pack) requires OPENROUTER_API_KEY (.swarmforge/openrouter.env)" >&2
        return 1
      }
      command -v claude >/dev/null 2>&1 || {
        echo "ancillary_provider: claude CLI required for OpenRouter pack" >&2
        return 1
      }
      ;;
    gemini)
      [[ -n "${GEMINI_API_KEY:-}" ]] || {
        echo "ancillary_provider: pack $(ancillary_provider_pack) requires GEMINI_API_KEY" >&2
        return 1
      }
      command -v gemini >/dev/null 2>&1 || {
        echo "ancillary_provider: gemini CLI required for Gemini pack" >&2
        return 1
      }
      ;;
    codex)
      [[ -n "${OPENAI_API_KEY:-}" ]] || {
        echo "ancillary_provider: pack $(ancillary_provider_pack) requires OPENAI_API_KEY" >&2
        return 1
      }
      command -v codex >/dev/null 2>&1 || {
        echo "ancillary_provider: codex CLI required for Codex pack" >&2
        return 1
      }
      ;;
    openai_aider)
      if [[ "${SWARMFORGE_USE_PERPLEXITY:-}" == "1" ]]; then
        [[ -n "${PERPLEXITY_API_KEY:-}" ]] || {
          echo "ancillary_provider: pack $(ancillary_provider_pack) requires PERPLEXITY_API_KEY" >&2
          return 1
        }
      elif [[ "${SWARMFORGE_USE_QWEN:-}" == "1" ]]; then
        [[ -n "${QWEN_API_KEY:-}" ]] || {
          echo "ancillary_provider: pack $(ancillary_provider_pack) requires QWEN_API_KEY" >&2
          return 1
        }
      elif [[ "${SWARMFORGE_USE_CEREBRAS:-}" == "1" ]]; then
        [[ -n "${CEREBRAS_API_KEY:-}" ]] || {
          echo "ancillary_provider: pack $(ancillary_provider_pack) requires CEREBRAS_API_KEY" >&2
          return 1
        }
      elif [[ -n "${MISTRAL_API_KEY:-}" && "$ANCILLARY_PROVIDER_PACK" == vibe-* ]]; then
        :
      else
        [[ -n "${OPENAI_API_KEY:-}" ]] || {
          echo "ancillary_provider: pack $(ancillary_provider_pack) requires a provider API key" >&2
          return 1
        }
      fi
      command -v aider >/dev/null 2>&1 || {
        echo "ancillary_provider: aider required for pack $(ancillary_provider_pack)" >&2
        return 1
      }
      ;;
    claude_direct)
      command -v claude >/dev/null 2>&1 || {
        echo "ancillary_provider: claude CLI required" >&2
        return 1
      }
      ;;
  esac
}

ancillary_provider_coordinator_model() {
  local conf="${ANCILLARY_PROVIDER_CONF_PATH:-}"
  if [[ -n "$conf" && -f "$conf" ]]; then
    awk '/^config coordinator_model / {print $3; exit}' "$conf"
  fi
}

ancillary_provider_default_model() {
  local role="${1:?role}"
  case "$ANCILLARY_PROVIDER_FAMILY" in
    openrouter)
      printf '%s\n' "anthropic/claude-sonnet-5"
      ;;
    gemini)
      if [[ "$role" == front_desk ]]; then printf '%s\n' "gemini-2.5-flash"
      else printf '%s\n' "gemini-2.5-pro"
      fi
      ;;
    codex)
      if [[ "$role" == front_desk ]]; then printf '%s\n' "gpt-5.4-mini"
      else printf '%s\n' "gpt-5.5"
      fi
      ;;
    openai_aider)
      local cm
      cm="$(ancillary_provider_coordinator_model)"
      if [[ -n "$cm" ]]; then printf '%s\n' "$cm"
      else printf '%s\n' "openai/sonar"
      fi
      ;;
    claude_direct)
      if [[ "$role" == operator ]]; then printf '%s\n' "claude-opus-4-8"
      else printf '%s\n' "claude-sonnet-5"
      fi
      ;;
  esac
}

ancillary_provider_pane_exports() {
  case "$ANCILLARY_PROVIDER_FAMILY" in
    openrouter)
      printf '%s\n' \
        "export ANTHROPIC_BASE_URL='https://openrouter.ai/api'" \
        'unset ANTHROPIC_API_KEY' \
        'export ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY"'
      ;;
    gemini)
      printf '%s\n' \
        'export GEMINI_API_KEY="$GEMINI_API_KEY"' \
        'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL OPENROUTER_API_KEY'
      ;;
    codex)
      printf '%s\n' \
        'export OPENAI_API_KEY="$OPENAI_API_KEY"' \
        'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL OPENROUTER_API_KEY GEMINI_API_KEY'
      ;;
    openai_aider)
      if [[ "${SWARMFORGE_USE_PERPLEXITY:-}" == "1" && -n "${PERPLEXITY_API_KEY:-}" ]]; then
        printf '%s\n' \
          'export OPENAI_API_KEY="$PERPLEXITY_API_KEY"' \
          "export OPENAI_API_BASE='https://api.perplexity.ai'" \
          "export OPENAI_BASE_URL='https://api.perplexity.ai'"
      elif [[ "${SWARMFORGE_USE_QWEN:-}" == "1" && -n "${QWEN_API_KEY:-}" ]]; then
        printf '%s\n' \
          'export OPENAI_API_KEY="$QWEN_API_KEY"' \
          "export OPENAI_API_BASE='https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'" \
          "export OPENAI_BASE_URL='https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'"
      elif [[ "${SWARMFORGE_USE_CEREBRAS:-}" == "1" && -n "${CEREBRAS_API_KEY:-}" ]]; then
        printf '%s\n' \
          'export OPENAI_API_KEY="$CEREBRAS_API_KEY"' \
          "export OPENAI_API_BASE='https://api.cerebras.ai/v1'" \
          "export OPENAI_BASE_URL='https://api.cerebras.ai/v1'"
      else
        printf '%s\n' 'export OPENAI_API_KEY="$OPENAI_API_KEY"'
      fi
      printf '%s\n' 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL OPENROUTER_API_KEY GEMINI_API_KEY'
      ;;
    claude_direct)
      printf '%s\n' 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL OPENROUTER_API_KEY GEMINI_API_KEY'
      ;;
  esac
}

# Sets global ANCILLARY_TMUX_ENV (array) for tmux new-session -e flags.
ANCILLARY_TMUX_ENV=()
ancillary_provider_fill_tmux_env() {
  ANCILLARY_TMUX_ENV=()
  case "$ANCILLARY_PROVIDER_FAMILY" in
    openrouter) ANCILLARY_TMUX_ENV=(-e "OPENROUTER_API_KEY=${OPENROUTER_API_KEY}") ;;
    gemini) ANCILLARY_TMUX_ENV=(-e "GEMINI_API_KEY=${GEMINI_API_KEY}") ;;
    codex) ANCILLARY_TMUX_ENV=(-e "OPENAI_API_KEY=${OPENAI_API_KEY}") ;;
    openai_aider)
      if [[ "${SWARMFORGE_USE_PERPLEXITY:-}" == "1" ]]; then
        ANCILLARY_TMUX_ENV=(-e "PERPLEXITY_API_KEY=${PERPLEXITY_API_KEY}")
      elif [[ "${SWARMFORGE_USE_QWEN:-}" == "1" ]]; then
        ANCILLARY_TMUX_ENV=(-e "QWEN_API_KEY=${QWEN_API_KEY}")
      elif [[ "${SWARMFORGE_USE_CEREBRAS:-}" == "1" ]]; then
        ANCILLARY_TMUX_ENV=(-e "CEREBRAS_API_KEY=${CEREBRAS_API_KEY}")
      else
        ANCILLARY_TMUX_ENV=(-e "OPENAI_API_KEY=${OPENAI_API_KEY}")
      fi
      ;;
    claude_direct) ANCILLARY_TMUX_ENV=() ;;
  esac
}

ancillary_provider_write_claude_settings() {
  local template="${1:?}"
  local dest="${2:?}"
  local model="${3:?}"
  local effort="${4:-high}"
  if command -v python3 >/dev/null 2>&1 && [[ -f "$template" ]]; then
    python3 - "$template" "$dest" "$model" "$effort" <<'PY'
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
    cat > "$dest" <<EOF
{
  "model": "${model}",
  "effortLevel": "${effort}",
  "skipDangerousModePermissionPrompt": true,
  "permissions": { "defaultMode": "bypassPermissions" }
}
EOF
  fi
}

# Wrap plain-text LLM stdout as the JSON shape operator_lib/front-desk-reply-text expects.
ancillary_provider_write_front_desk_result_json() {
  local text_file="${1:?}"
  local result_json="${2:?}"
  local is_error="${3:-false}"
  python3 - "$text_file" "$result_json" "$is_error" <<'PY'
import json, sys
text_path, out_path, is_error = sys.argv[1:4]
try:
    with open(text_path, encoding="utf-8") as f:
        text = f.read().strip()
except FileNotFoundError:
    text = ""
payload = {
    "type": "result",
    "subtype": "success" if is_error != "true" else "error",
    "is_error": is_error == "true",
    "result": text,
    "total_cost_usd": None,
    "model": None,
}
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
    f.write("\n")
PY
}

ancillary_provider_dryrun_label() {
  printf '%s\n' "${ANCILLARY_PROVIDER_FAMILY:-unknown}"
}
