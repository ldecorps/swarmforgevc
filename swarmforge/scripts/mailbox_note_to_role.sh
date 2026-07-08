#!/usr/bin/env bash
# Send a note handoff via mailbox only (handoffd delivers; no tmux inject).
#
# Usage:
#   mailbox_note_to_role.sh <recipient-role> "<message>" [sender-role]
#
# Requires handoffd running (SWARMFORGE_SKIP_DAEMON unset at swarm launch).
# Sets SWARMFORGE_MAILBOX_ONLY=1 and SWARMFORGE_SKIP_SYNC_INJECT=1 for this send.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() {
  cat <<'EOF'
Usage: mailbox_note_to_role.sh <recipient-role> "<message>" [sender-role]

Queues a note to outbox/; handoffd copies to inbox/new/ without tmux wake.
Agents must discover mail via ready_for_next.sh (idle poll or human nudge).

Requires: live swarm + running handoffd (do not set SWARMFORGE_SKIP_DAEMON=1).
EOF
}

if [[ $# -lt 2 ]]; then
  usage >&2
  exit 1
fi

RECIPIENT="$1"
MESSAGE="$2"
SENDER="${3:-${SWARMFORGE_ROLE:-coordinator}}"

if [[ ${#MESSAGE} -gt 80 ]]; then
  echo "Error: message must be at most 80 characters (got ${#MESSAGE})." >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
if [[ "${SWARMFORGE_SKIP_DAEMON:-}" == "1" ]]; then
  echo "Error: SWARMFORGE_SKIP_DAEMON=1 — relaunch swarm without SKIP_DAEMON for mailbox-only mode." >&2
  exit 1
fi

export SWARMFORGE_MAILBOX_ONLY=1
export SWARMFORGE_SKIP_SYNC_INJECT=1
export SWARMFORGE_ROLE="$SENDER"

DRAFT="$(mktemp "${TMPDIR:-/tmp}/swarmforge-mailbox.XXXXXX.handoff")"
trap 'rm -f "$DRAFT"' EXIT

cat > "$DRAFT" <<EOF
type: note
to: ${RECIPIENT}
priority: 50
message: ${MESSAGE}
EOF

echo "Queueing mailbox note from ${SENDER} → ${RECIPIENT} (no tmux inject)"
"$SCRIPT_DIR/swarm_handoff.sh" "$DRAFT"

DAEMON_PID_FILE="$ROOT/.swarmforge/daemon/handoffd.pid"
if [[ -f "$DAEMON_PID_FILE" ]] && kill -0 "$(<"$DAEMON_PID_FILE")" 2>/dev/null; then
  echo "Waiting for handoffd to deliver (poll)..."
  for _ in $(seq 1 15); do
    SWARMFORGE_MAILBOX_ONLY=1 bb "$SCRIPT_DIR/handoffd.bb" "$ROOT" --poll-once >/dev/null 2>&1 || true
    sleep 0.2
  done
else
  echo "Warning: handoffd not running — parcel stays in outbox until daemon starts." >&2
fi

INBOX_DIR="$ROOT/.worktrees/${RECIPIENT}/.swarmforge/handoffs/inbox/new"
if [[ "$RECIPIENT" == "coordinator" || "$RECIPIENT" == "coder" ]] && [[ -d "$ROOT/.swarmforge/handoffs/inbox/new" ]]; then
  INBOX_DIR="$ROOT/.swarmforge/handoffs/inbox/new"
fi

if compgen -G "${INBOX_DIR}"/*"_for_${RECIPIENT}.handoff" >/dev/null 2>&1; then
  echo "Parcel in inbox: $(ls -1t "${INBOX_DIR}"/*"_for_${RECIPIENT}.handoff" 2>/dev/null | head -1)"
  grep -q "delivered-mailbox-only" "$ROOT/.swarmforge/daemon/handoffd.log" 2>/dev/null \
    && echo "Daemon log: delivered-mailbox-only (no tmux wake)" || true
else
  echo "Warning: parcel not yet in ${INBOX_DIR} — check outbox and handoffd.log" >&2
fi

echo "Daemon log: $ROOT/.swarmforge/daemon/handoffd.log"
