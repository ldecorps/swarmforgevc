#!/usr/bin/env bash
# BL-1142: classify / enforce local Ollama pack shape (mono vs capped forge).
# Sourced by local_ollama_pack_shape_gate.sh and unit runners. No side effects.
#
# Durable decision for this WSL/CPU host: mono-router depth 1
# (see docs/how-to/BL-1142-local-ollama-mono-vs-forge-cpu.md).

# Max concurrent active tickets for the local Ollama mono pack.
LOCAL_OLLAMA_MONO_MAX_DEPTH="${LOCAL_OLLAMA_MONO_MAX_DEPTH:-1}"

# Pack basenames that must never be used as the local Ollama substitute path.
bl1142_is_forbidden_substitute_pack() {
  case "${1:-}" in
    qwen-forge|*-qwen-forge|token-plan-forge|*-token-plan-forge) return 0 ;;
    *) return 1 ;;
  esac
}

# Extract config value from pack body: "config <key> <value>"
bl1142_pack_config() {
  local body="$1" key="$2"
  printf '%s\n' "$body" | awk -v k="$key" '
    $1=="config" && $2==k { print $3; exit }
  '
}

# Count window lines (standing seats) in pack body.
bl1142_window_count() {
  printf '%s\n' "$1" | awk '$1=="window"{n++} END{print n+0}'
}

# Classify a pack body for local Ollama staffing.
# Prints one of: mono-router | capped-forge | uncapped-forge | unknown
# Args: pack_body
bl1142_classify_router_shape() {
  local depth="$1"
  if [[ -n "$depth" && "$depth" -le "$LOCAL_OLLAMA_MONO_MAX_DEPTH" ]]; then
    echo mono-router
    return 0
  fi
  # Router without a tight depth is still rotation-disciplined but not our
  # durable local default — treat as capped-forge only when depth is set.
  if [[ -n "$depth" && "$depth" -gt 0 ]]; then
    echo capped-forge
    return 0
  fi
  echo uncapped-forge
}

bl1142_classify_standing_shape() {
  local depth="$1" windows="$2"
  # Standing (non-router) local multi-seat without a positive depth cap
  # would wedge Ollama under concurrent seats.
  if [[ -n "$depth" && "$depth" -gt 0 && "$windows" -le 8 ]]; then
    echo capped-forge
    return 0
  fi
  if [[ "$windows" -gt 1 ]]; then
    echo uncapped-forge
    return 0
  fi
  echo unknown
}

bl1142_classify_pack_shape() {
  local body="$1"
  local rotation depth windows
  rotation="$(bl1142_pack_config "$body" rotation)"
  depth="$(bl1142_pack_config "$body" active_backlog_max_depth)"
  windows="$(bl1142_window_count "$body")"

  if [[ "$rotation" == "router" ]]; then
    bl1142_classify_router_shape "$depth"
    return 0
  fi
  bl1142_classify_standing_shape "$depth" "$windows"
}

# Exit 0 if shape is allowed under the durable mono decision.
# Args: shape
bl1142_shape_allowed_for_local_decision() {
  case "${1:-}" in
    mono-router) return 0 ;;
    *) return 1 ;;
  esac
}
