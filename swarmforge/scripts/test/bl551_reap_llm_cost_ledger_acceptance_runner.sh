#!/usr/bin/env bash
# BL-551 writer-reap-03: acceptance runner driving operator_runtime.bb's REAL
# reap-finished-front-desk-operator! path end to end against an isolated
# fixture, mirroring bl511_bridge_cost_capture_acceptance_runner.sh's own
# --tick-once/fixture convention (that runner is BL-511's proof that the
# reap captures bridge-cost.jsonl before deleting the result file; this one
# is BL-551's own analogous proof that the SAME reap also appends to the
# unified llm-cost ledger, before the same delete, via
# llm-cost-ledger-lib/append-llm-invocation-record! +
# operator-lib/front-desk-reap-llm-invocation-record).
#
# Usage: bl551_reap_llm_cost_ledger_acceptance_runner.sh <result-json>
# Prints two lines to stdout:
#   line 1: RESULT_FILE_PRESENT or RESULT_FILE_DELETED
#   remaining lines: the resulting llm-cost ledger jsonl content, or NO_LOG
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
RESULT_JSON="${1:?usage: bl551_reap_llm_cost_ledger_acceptance_runner.sh <result-json>}"

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

LEDGER_DIR="$D/.swarmforge/telemetry"
if compgen -G "$LEDGER_DIR/llm-cost-*.jsonl" > /dev/null; then
  cat "$LEDGER_DIR"/llm-cost-*.jsonl
else
  echo "NO_LOG"
fi
