#!/usr/bin/env bash
# BL-551 writer-handoff-02: acceptance runner driving handoffd.bb's REAL
# deliver! path end to end against an isolated fixture, mirroring
# test_handoffd_per_recipient_delivery.sh's own daemon-spawn convention (that
# suite is the delivery mechanism's primary regression proof; this runner
# exists so the SAME real correlation-stamp-before-wake behavior wired into
# deliver! - BL-551's llm-cost-ledger-lib/append-llm-invocation-record! call -
# is also visible to the Gherkin acceptance layer BL-551's ticket points at).
#
# Usage: bl551_handoff_delivery_llm_cost_ledger_acceptance_runner.sh <ticket-id> <handoff-type>
# Prints the resulting llm-cost ledger jsonl content (one JSON object per
# line), or NO_LOG if no ledger file was produced.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

TICKET_ID="${1:?usage: bl551_handoff_delivery_llm_cost_ledger_acceptance_runner.sh <ticket-id> <handoff-type>}"
HANDOFF_TYPE="${2:?usage: bl551_handoff_delivery_llm_cost_ledger_acceptance_runner.sh <ticket-id> <handoff-type>}"

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1  # BL-406: opt in - this ROOT is an intentional throwaway test root
DAEMON_PID=""
cleanup() {
  [[ -n "$DAEMON_PID" ]] && kill "$DAEMON_PID" 2>/dev/null || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

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

# ── fake tmux so notify! succeeds without a real session ─────────────────────
FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

CODER_INBOX_NEW="$CODER_WT/.swarmforge/handoffs/inbox/new"

# ── run the daemon until it delivers the single outbox handoff, then stop it ─
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
