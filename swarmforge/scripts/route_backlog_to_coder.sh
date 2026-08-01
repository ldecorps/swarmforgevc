#!/usr/bin/env bash
# Route a backlog/active item via sync handoff (phase-1, no daemon) — to
# coder by default, or to the specifier when the ticket's own assigned_to
# says so (promotion_gates; BL-663 instance 3/7: this is the SECOND,
# independent assigned_to rewrite site — invoked on its own, outside a
# promotion, it must obey the same gate promote_and_route_next.sh does,
# never force assigned_to back to coder as a side effect of routing).
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
handoff through swarm_handoff.sh (SWARMFORGE_SKIP_DAEMON=1) to coder, or to
the specifier when the ticket's own assigned_to says so.
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

# promotion_gates: the routing target and whether assigned_to may be
# rewritten both come from the shared BL-663 chokepoint — assigned_to:
# specifier is never rewritten and routes to the specifier; every other
# value is corrected to coder only when it does not already read coder.
ROUTE_DECISION="$(bb "$SCRIPT_DIR/promotion_gates_cli.bb" route-target "$ROOT" "$YAML")"
ROLE="${ROUTE_DECISION%% *}"
FLAG="${ROUTE_DECISION##* }"
if [[ "$FLAG" == "REWRITE" ]]; then
  if grep -qE '^assigned_to:' "$YAML"; then
    perl -pi -e "s/^assigned_to:.*/assigned_to: ${ROLE}/" "$YAML"
  else
    printf '\nassigned_to: %s\n' "$ROLE" >> "$YAML"
  fi
fi

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
to: ${ROLE}
priority: 10
message: ${MSG}
EOF

echo "Routing $(basename "$YAML") → ${ROLE} (message: ${MSG})"
"$SCRIPT_DIR/swarm_handoff.sh" "$DRAFT"

INBOX="$(bb "$SCRIPT_DIR/mailbox_dir.bb" "$ROOT" "$ROLE" new)"
if compgen -G "${INBOX}"/*"_for_${ROLE}.handoff" >/dev/null 2>&1; then
  echo "${ROLE^} inbox: $(ls -1t "${INBOX}"/*"_for_${ROLE}.handoff" | head -1)"
else
  echo "Warning: parcel not found in ${INBOX} — see .swarmforge/handoffs/inject-traffic.log" >&2
  exit 1
fi
