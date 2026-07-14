#!/usr/bin/env bash
# Send a note handoff to a role via phase-1 sync tmux injection (no handoffd).
#
# Usage:
#   inject_note_to_role.sh <recipient-role> "<message>" [sender-role]
#
# Examples:
#   SWARMFORGE_SKIP_DAEMON=1 ./swarmforge/scripts/inject_note_to_role.sh QA "tmux inject probe"
#   SWARMFORGE_SKIP_DAEMON=1 ./swarmforge/scripts/inject_note_to_role.sh coder "pick up BL-154" coordinator
#
# Requires a live swarm (tmux socket + roles.tsv). Sets SWARMFORGE_SKIP_DAEMON=1
# if not already set.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() {
  cat <<'EOF'
Usage: inject_note_to_role.sh <recipient-role> "<message>" [sender-role]

Sends a priority-50 note through swarm_handoff.sh with sync tmux delivery.
Default sender: coordinator (override with 3rd arg or SWARMFORGE_ROLE).
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

export SWARMFORGE_SKIP_DAEMON="${SWARMFORGE_SKIP_DAEMON:-1}"
export SWARMFORGE_ROLE="$SENDER"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
DRAFT="$(mktemp "${TMPDIR:-/tmp}/swarmforge-inject.XXXXXX.handoff")"
trap 'rm -f "$DRAFT"' EXIT

cat > "$DRAFT" <<EOF
type: note
to: ${RECIPIENT}
priority: 50
message: ${MESSAGE}
EOF

echo "Injecting note from ${SENDER} → ${RECIPIENT} (SWARMFORGE_SKIP_DAEMON=${SWARMFORGE_SKIP_DAEMON})"
"$SCRIPT_DIR/swarm_handoff.sh" "$DRAFT"

INBOX_DIR="$(bb "$SCRIPT_DIR/mailbox_dir.bb" "$ROOT" "$RECIPIENT" new)"

if compgen -G "${INBOX_DIR}"/*"_for_${RECIPIENT}.handoff" >/dev/null 2>&1; then
  echo "Parcel in inbox: $(ls -1t "${INBOX_DIR}"/*"_for_${RECIPIENT}.handoff" 2>/dev/null | head -1)"
else
  echo "Warning: no parcel found in ${INBOX_DIR} — check inject-traffic.log" >&2
fi

echo "Traffic log: $ROOT/.swarmforge/handoffs/inject-traffic.log"
echo "Tail: $SCRIPT_DIR/inject_traffic.sh -n 5"
