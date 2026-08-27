#!/usr/bin/env bash
# Connected-suite behavioral probe — deterministic proof the agent ran a repo script.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
MARKER="$ROOT/swarmforge/runtime/connected-probe.ok"
mkdir -p "$(dirname "$MARKER")"
printf 'connected-probe %s\n' "$(date -u +%Y%m%dT%H%M%SZ)" >"$MARKER"
echo "CONNECTED_PROBE_OK"
