#!/usr/bin/env bash
# BL-565 pipeline-record-carries-tokens-01: acceptance runner driving
# handoffd.bb's REAL deliver! path with GH-22 context-events seeded first,
# mirroring bl551_handoff_delivery_llm_cost_ledger_acceptance_runner.sh.
#
# Usage: bl565_handoff_delivery_with_telemetry_runner.sh <ticket-id> <handoff-type> [seed-telemetry]
#   seed-telemetry: "yes" (default) writes a context-events.jsonl row for the
#                   coder recipient before delivery; "no" leaves telemetry absent.
# Prints the resulting llm-cost ledger jsonl content (one JSON object per
# line), or NO_LOG if no ledger file was produced.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

TICKET_ID="${1:?usage: bl565_handoff_delivery_with_telemetry_runner.sh <ticket-id> <handoff-type> [seed-telemetry]}"
HANDOFF_TYPE="${2:?usage: bl565_handoff_delivery_with_telemetry_runner.sh <ticket-id> <handoff-type> [seed-telemetry]}"
SEED_TELEMETRY="${3:-yes}"

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1
DAEMON_PID=""
cleanup() {
  [[ -n "$DAEMON_PID" ]] && kill "$DAEMON_PID" 2>/dev/null || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge/telemetry"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

if [[ "$SEED_TELEMETRY" == "yes" ]]; then
  printf '%s\n' \
    '{"agent":"coder-session","role":"coder","session_id":"bl565-s1","timestamp":"2026-07-22T11:55:00Z","input_tokens":1000000,"output_tokens":500000,"context_utilization_pct":42,"compaction":false,"provider":"anthropic","model":"claude-sonnet-5"}' \
    > "$ROOT/.swarmforge/telemetry/context-events.jsonl"
fi

CODER_WT="$ROOT/.worktrees/coder"
printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT" \
  > "$ROOT/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" \
  >> "$ROOT/.swarmforge/roles.tsv"

SPECIFIER_OUTBOX="$ROOT/.swarmforge/handoffs/specifier/outbox"
mkdir -p "$SPECIFIER_OUTBOX"
printf 'id: 00_20260722T000000Z_000001_from_specifier_to_coder\nfrom: specifier\nto: coder\npriority: 50\ntype: %s\ntask: %s\n\nbody\n' \
  "$HANDOFF_TYPE" "$TICKET_ID" \
  > "$SPECIFIER_OUTBOX/00_20260722T000000Z_000001_from_specifier_to_coder.handoff"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

CODER_INBOX_NEW="$CODER_WT/.swarmforge/handoffs/inbox/new"

PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!

for _ in $(seq 1 40); do
  [[ -n "$(find "$CODER_INBOX_NEW" -maxdepth 1 -name '*.handoff' 2>/dev/null)" ]] && break
  sleep 0.25
done

mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true

LEDGER_DIR="$ROOT/.swarmforge/telemetry"
if compgen -G "$LEDGER_DIR/llm-cost-*.jsonl" > /dev/null; then
  cat "$LEDGER_DIR"/llm-cost-*.jsonl
else
  echo "NO_LOG"
fi
