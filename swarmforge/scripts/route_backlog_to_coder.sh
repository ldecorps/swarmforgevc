#!/usr/bin/env bash
# Route a backlog/active item to coder via sync handoff (phase-1, no daemon).
#
# Usage:
#   route_backlog_to_coder.sh [BL-id] [project-root]
#   route_backlog_to_coder.sh              # first *.yaml in backlog/active
#   route_backlog_to_coder.sh BL-154
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() {
  cat <<'EOF'
Usage: route_backlog_to_coder.sh [BL-id] [project-root]

Finds a backlog/active/*.yaml (by BL-id prefix or first file), sends a note
handoff to coder through swarm_handoff.sh with SWARMFORGE_SKIP_DAEMON=1.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ROOT=""
ITEM=""

if [[ $# -eq 0 ]]; then
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
elif [[ $# -eq 1 ]]; then
  if [[ -d "$1" ]]; then
    ROOT="$(cd "$1" && pwd)"
  else
    ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
    ITEM="$1"
  fi
else
  ITEM="$1"
  ROOT="$(cd "$2" && pwd)"
fi

YAML=""
if [[ -n "$ITEM" ]]; then
  YAML="$(find "$ROOT/backlog/active" -maxdepth 1 -name "${ITEM}*.yaml" -type f 2>/dev/null | head -1)"
else
  YAML="$(find "$ROOT/backlog/active" -maxdepth 1 -name '*.yaml' -type f 2>/dev/null | sort | head -1)"
fi

if [[ -z "$YAML" || ! -f "$YAML" ]]; then
  echo "Error: no backlog/active/*.yaml found${ITEM:+ for ${ITEM}}" >&2
  exit 1
fi

BASENAME="$(basename "$YAML" .yaml)"
MSG="Work ${BASENAME}: read file in backlog/active"
if (( ${#MSG} > 80 )); then
  MSG="${MSG:0:80}"
fi

export SWARMFORGE_SKIP_DAEMON="${SWARMFORGE_SKIP_DAEMON:-1}"
export SWARMFORGE_ROLE="${SWARMFORGE_ROLE:-coordinator}"

DRAFT="$(mktemp "${TMPDIR:-/tmp}/swarmforge-route.XXXXXX.handoff")"
trap 'rm -f "$DRAFT"' EXIT

cat > "$DRAFT" <<EOF
type: note
to: coder
priority: 10
message: ${MSG}
EOF

echo "Routing $(basename "$YAML") → coder (message: ${MSG})"
"$SCRIPT_DIR/swarm_handoff.sh" "$DRAFT"

INBOX="$ROOT/.swarmforge/handoffs/inbox/new"
if compgen -G "${INBOX}"/*"_for_coder.handoff" >/dev/null 2>&1; then
  echo "Coder inbox: $(ls -1t "${INBOX}"/*"_for_coder.handoff" | head -1)"
else
  echo "Warning: parcel not found in ${INBOX} — see .swarmforge/handoffs/inject-traffic.log" >&2
  exit 1
fi
