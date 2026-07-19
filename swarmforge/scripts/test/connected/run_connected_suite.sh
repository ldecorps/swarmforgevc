#!/usr/bin/env bash
# Connected test suite — live tmux sessions + real agent CLIs (mistral, claude, gpt).
#
# NOT part of the unit test suite. Requires API keys and installed agent CLIs.
#
# Does NOT start VS Code, Cursor, or the SwarmForge extension. Runs headless
# tmux in a temp git repo (SWARMFORGE_TERMINAL=none). If VS Code appears,
# it is from extension dev (F5 / start-extension-dev.sh), not this script.
#
# Two layers per provider:
#   1. Transport — launch, handoff deliver, wake, route_backlog, attach, ensure
#   2. Behavioral — agent must execute connected_agent_probe.sh via swarm mail
#
# Usage:
#   ./run_connected_suite.sh
#   CONNECTED_PROVIDERS=mistral ./run_connected_suite.sh
#   CONNECTED_TRANSPORT_ONLY=1 ./run_connected_suite.sh   # skip behavioral
#
# API keys in ~/.zshrc are loaded automatically when not already exported.
#
# Skips a provider when its CLI or API key is missing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

PROVIDERS="${CONNECTED_PROVIDERS:-mistral,claude,gpt}"
IFS=',' read -r -a PROVIDER_LIST <<< "$PROVIDERS"

failures=0
for provider in "${PROVIDER_LIST[@]}"; do
  provider="$(echo "$provider" | tr -d '[:space:]')"
  [[ -n "$provider" ]] || continue
  if ! connected_run_provider_suite "$provider"; then
    failures=$((failures + 1))
  fi
done

if (( failures > 0 )); then
  echo ""
  echo "$failures provider suite(s) failed" >&2
  exit 1
fi

echo ""
echo "CONNECTED SUITE: ALL PROVIDERS PASSED"
