#!/usr/bin/env bash
# Back-compat shim — use ancillary_provider_lib.sh directly in new code.
# shellcheck source=ancillary_provider_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ancillary_provider_lib.sh"

openrouter_claude_env_load() {
  ancillary_provider_load "$1"
}

openrouter_claude_env_active() {
  [[ "${ANCILLARY_PROVIDER_LOADED:-0}" == 1 ]] && [[ "$(ancillary_provider_family)" == openrouter ]]
}

openrouter_claude_env_exports() {
  ancillary_provider_pane_exports
}

openrouter_claude_env_write_settings() {
  ancillary_provider_write_claude_settings "$@"
}
