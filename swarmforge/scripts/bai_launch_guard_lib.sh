#!/usr/bin/env bash
# 2026-09-09: shared b.ai launch-guard credential fallback for the Claude
# Code (Anthropic-compat) path, mirroring qwen_launch_guard_lib.sh's own
# qwen_guard_map_anthropic_compat exactly. b.ai's Messages API is confirmed
# (docs.b.ai/llmservice/api/) to be Anthropic-Messages-protocol compatible
# at the SAME host/path as its OpenAI-compat surface
# (https://api.b.ai/v1 - the client appends /messages itself, same as it
# appends /chat/completions for the OpenAI-compat surface); only the
# protocol the client speaks differs, not the URL.
#
# Deliberately does NOT declare CLAUDE_CODE_MAX_CONTEXT_TOKENS the way
# qwen_guard_map_anthropic_compat does for Qwen's officially-documented 1M
# window - the model steward's own registry has glm-5.3-flash's
# context_window as null (unconfirmed), so no specific number is claimed
# here. If Claude Code's ~50k auto-compact-on-unrecognized-model bug is
# observed live on this path, that is the number to go source before
# adding an override, not a guess.
#
# Sourced by write_role_launch_script output - one implementation for
# every entry point, same posture as the Qwen lib.

# shellcheck shell=bash

BAI_ANTHROPIC_URL='https://api.b.ai/v1'

bai_guard_map_anthropic_compat() {
  if [[ -z "${B_AI_API_KEY:-}" ]]; then
    echo "SwarmForge: B_AI_API_KEY required for b.ai Anthropic-compat" >&2
    return 1
  fi
  export SWARMFORGE_USE_BAI=1
  unset ANTHROPIC_API_KEY || true
  export ANTHROPIC_BASE_URL="$BAI_ANTHROPIC_URL"
  export ANTHROPIC_AUTH_TOKEN="$B_AI_API_KEY"
  return 0
}
