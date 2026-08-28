#!/usr/bin/env bash
# BL-1228: reports every backlog/active/ ticket whose deprecator freshness
# check (Article 3.6) does not positively return "allow". Report only -
# never moves, creates, deletes, or rewrites a backlog file. Fail-closed on
# a missing/crashing/unparseable CLI (see active-pool-freshness-audit.ts).
#
# Usage: active_pool_freshness_audit.sh [project-root]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ROOT="${1:-}"
if [[ -z "$ROOT" ]]; then
  ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

CLI="$ROOT/extension/out/tools/active-pool-freshness-audit.js"
if [[ ! -f "$CLI" ]]; then
  CLI="$SCRIPT_DIR/../../extension/out/tools/active-pool-freshness-audit.js"
fi

if [[ ! -f "$CLI" ]]; then
  echo "active_pool_freshness_audit: active-pool-freshness-audit.js not built (run npm run compile in extension/) — nothing to report" >&2
  exit 0
fi

node "$CLI" "$ROOT"
