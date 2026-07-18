#!/usr/bin/env bash
# BL-511: acceptance runner for reap-finished-front-desk-operator!'s bridge-
# cost capture (operator_runtime.bb) - drives the REAL reap path via
# --tick-once against an isolated fixture, mirroring
# test_operator_runtime_tick.sh's own make_fixture/tick convention (that
# suite is this behavior's primary regression proof; this runner exists so
# the SAME real capture-before-delete behavior is also visible to the
# Gherkin acceptance layer BL-511's ticket points at). Copies the WHOLE
# scripts/ directory rather than a curated file list, so this never drifts
# out of sync with operator_runtime.bb's own load-file dependencies as they
# grow.
#
# Usage: bl511_bridge_cost_capture_acceptance_runner.sh <result-json>
# Prints two lines to stdout:
#   line 1: RESULT_FILE_PRESENT or RESULT_FILE_DELETED
#   remaining lines: the resulting bridge-cost.jsonl content, or NO_LOG
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
RESULT_JSON="${1:?usage: bl511_bridge_cost_capture_acceptance_runner.sh <result-json>}"

D="$(mktemp -d)"
trap 'rm -rf "$D"' EXIT
mkdir -p "$D/.swarmforge/operator" "$D/swarmforge/scripts" "$D/.swarmforge/support/threads"
cp "$SRC"/*.bb "$D/swarmforge/scripts/"

printf '{"type":"TELEGRAM_TOPIC_MESSAGE","subject":"SUP-1"}\n' > "$D/.swarmforge/operator/front-desk.events.inflight.jsonl"
printf '{"thread-id":"SUP-1"}' > "$D/.swarmforge/operator/front-desk-dispatch-context.json"
printf '%s' "$RESULT_JSON" > "$D/.swarmforge/operator/front-desk-result.json"
printf '{"id":"SUP-1","status":"open","messages":[]}' > "$D/.swarmforge/support/threads/SUP-1.json"

OPERATOR_SKIP_LAUNCH=1 SWARMFORGE_SANDBOX_SWEEP_ROOT="$D/.no-sandbox-sweep" SWARMFORGE_FIXTURE_REAP_ROOT="$D/.no-fixture-reap" SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS="" \
  bb "$D/swarmforge/scripts/operator_runtime.bb" "$D" --tick-once >/dev/null

if [[ -f "$D/.swarmforge/operator/front-desk-result.json" ]]; then
  echo "RESULT_FILE_PRESENT"
else
  echo "RESULT_FILE_DELETED"
fi
if [[ -f "$D/.swarmforge/operator/bridge-cost.jsonl" ]]; then
  cat "$D/.swarmforge/operator/bridge-cost.jsonl"
else
  echo "NO_LOG"
fi
