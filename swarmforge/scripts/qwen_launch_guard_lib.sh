#!/usr/bin/env bash
# BL-1077: shared Qwen launch-guard credential fallbacks.
#
# Pack PREREQ docs name BAILIAN_TOKEN_PLAN_API_KEY as preferred; start-swarm-qwen.sh
# and ancillary_provider_lib.sh already honor it. The generated launch guard must
# accept the same names in the same order, and never displace an explicit
# QWEN_API_KEY. Sourced by write_role_launch_script output and by acceptance
# steps — one implementation for every entry point.

# shellcheck shell=bash

QWEN_TOKEN_PLAN_BASE_URL='https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'

qwen_guard_accepted_credential_names() {
  printf '%s' 'QWEN_API_KEY (or BAILIAN_TOKEN_PLAN_API_KEY or BAILIAN_CODING_PLAN_API_KEY)'
}

# Apply documented fallbacks into QWEN_API_KEY. Leaves an already-set
# QWEN_API_KEY untouched. Order matches start-swarm-qwen.sh / ancillary_provider_lib.sh.
qwen_guard_apply_credential_fallbacks() {
  if [[ -z "${QWEN_API_KEY:-}" && -n "${BAILIAN_TOKEN_PLAN_API_KEY:-}" ]]; then
    export QWEN_API_KEY="$BAILIAN_TOKEN_PLAN_API_KEY"
  fi
  if [[ -z "${QWEN_API_KEY:-}" && -n "${BAILIAN_CODING_PLAN_API_KEY:-}" ]]; then
    export QWEN_API_KEY="$BAILIAN_CODING_PLAN_API_KEY"
  fi
}

# Strict branch: pack CLI targets the Token Plan endpoint. Refuse loudly when
# no accepted credential is present.
qwen_guard_require_token_plan_endpoint() {
  qwen_guard_apply_credential_fallbacks
  if [[ -n "${QWEN_API_KEY:-}" ]]; then
    export SWARMFORGE_USE_QWEN=1
    export OPENAI_API_KEY="$QWEN_API_KEY"
    export OPENAI_API_BASE="$QWEN_TOKEN_PLAN_BASE_URL"
    export OPENAI_BASE_URL="$QWEN_TOKEN_PLAN_BASE_URL"
    return 0
  fi
  echo "SwarmForge: $(qwen_guard_accepted_credential_names) required (launch CLI targets token-plan.ap-southeast-1.maas.aliyuncs.com)" >&2
  return 1
}

# Soft branch: pack CLI carries no endpoint URL; only map when the env flag
# already opted into Qwen.
qwen_guard_map_if_flagged() {
  qwen_guard_apply_credential_fallbacks
  if [[ "${SWARMFORGE_USE_QWEN:-}" == "1" && -n "${QWEN_API_KEY:-}" ]]; then
    export OPENAI_API_KEY="$QWEN_API_KEY"
    export OPENAI_API_BASE="${OPENAI_API_BASE:-$QWEN_TOKEN_PLAN_BASE_URL}"
    export OPENAI_BASE_URL="${OPENAI_BASE_URL:-$QWEN_TOKEN_PLAN_BASE_URL}"
  fi
}
