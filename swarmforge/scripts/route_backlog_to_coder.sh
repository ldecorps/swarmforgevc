#!/usr/bin/env bash
# Route a backlog/active item via sync handoff (phase-1, no daemon) — to
# coder by default, or to the specifier when the ticket's own assigned_to
# says so (promotion_gates; BL-663 instance 3/7: this is the SECOND,
# independent assigned_to rewrite site — invoked on its own, outside a
# promotion, it must obey the same gate promote_and_route_next.sh does,
# never force assigned_to back to coder as a side effect of routing).
#
# BL-1097: it also REFUSES to originate a parcel for a ticket that already has
# a dispatch trail. Article 1.9 forbids forwarding a parcel whose commit
# produces no functional change; the same rule has to bind the router that
# originates one. A ticket sits in backlog/active/ with its mint `status: todo`
# and its `assigned_to` from promotion until the coordinator's separate
# bookkeeping step moves it to backlog/done/, and nothing writes `status:` in
# between - so for that whole window finished work looks exactly like unstarted
# work here. The answer comes from dispatch_trail_cli.bb, which is the daemon's
# own dispatch-gap predicate, so the router and the sweep cannot disagree.
#
# Usage:
#   route_backlog_to_coder.sh [--force] [BL-id] [project-root]
#   route_backlog_to_coder.sh              # first *.yaml in backlog/active
#   route_backlog_to_coder.sh BL-154
#   route_backlog_to_coder.sh --force BL-154   # deliberate re-route
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() {
  cat <<'EOF'
Usage: route_backlog_to_coder.sh [--force] [BL-id] [project-root]

Finds a backlog/active/*.yaml (by BL-id prefix or first file), sends a note
handoff through swarm_handoff.sh (SWARMFORGE_SKIP_DAEMON=1) to coder, or to
the specifier when the ticket's own assigned_to says so.

Refuses (exit 3, nothing sent, nothing rewritten) when the ticket already has
a dispatch trail - it has been routed before, so a parcel now would carry work
that is already done (BL-1097). --force is the operator's explicit override for
a deliberate re-route, e.g. a ticket re-promoted out of backlog/done/.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

# --force is pulled out before the positional parsing below, so it may appear
# in any position and the BL-id/project-root forms keep working unchanged.
FORCE=0
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--force" ]]; then
    FORCE=1
  else
    ARGS+=("$arg")
  fi
done
# Stock macOS /bin/bash 3.2 raises "unbound variable" expanding an EMPTY array
# under set -u; the +"..." form is the portable spelling (BL-801).
set -- ${ARGS[@]+"${ARGS[@]}"}

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

# ── BL-1097: the no-op rule, applied to the sender ────────────────────────
# Before anything is written or rewritten. A refusal must leave the ticket
# EXACTLY as it found it - in particular it must not perform the assigned_to
# rewrite below, which would be a side effect of a route that never happened.
TICKET_ID="$(grep -E '^id:' "$YAML" | head -1 | awk '{print $2}' | tr -d '\r')"
[[ -n "$TICKET_ID" ]] || TICKET_ID="$BASENAME"

if (( FORCE == 0 )); then
  TRAIL_RC=0
  TRAIL_LINE="$(bb "$SCRIPT_DIR/dispatch_trail_cli.bb" "$ROOT" dispatched "$TICKET_ID")" || TRAIL_RC=$?
  TRAIL_ANSWER="${TRAIL_LINE%% *}"
  TRAIL_REASON="${TRAIL_LINE#* }"
  if (( TRAIL_RC != 0 )); then
    # Fail OPEN, and say so. A ticket that is never routed because the trail
    # could not be read is starved silently; a ticket routed twice is at worst
    # the defect this gate exists to reduce. The louder failure is the safer
    # one here.
    echo "route_backlog_to_coder: could not read the dispatch trail for ${TICKET_ID} (rc=${TRAIL_RC}) — routing anyway; see the error above" >&2
  elif [[ "$TRAIL_ANSWER" == "DISPATCHED" ]]; then
    echo "route_backlog_to_coder: ${TICKET_ID} already has a dispatch trail — NOT routing. A parcel now would carry work that is already done (Article 1.9 binds the sender too; BL-1097). If the ticket is finished, close it: move it to backlog/done/. If this is a deliberate re-route, pass --force." >&2
    exit 3
  elif [[ "$TRAIL_ANSWER" == "DROPPED" ]]; then
    # BL-1415: the recipient acted on this dispatch (dequeued/completed it)
    # and nothing followed - the SAME verdict the dropped-parcel sweep
    # already reached (chase_sweep_lib.bb's ticket-dispatch-verdict), so
    # routing here needs no --force; a human is not adjudicating a false
    # positive, they are unblocking a real one.
    echo "route_backlog_to_coder: ${TICKET_ID} - ${TRAIL_REASON} — routing without --force (BL-1415)." >&2
  fi
fi

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
  # Bash 3.2 (macOS /bin/bash) has no caret case-transform parameter
  # expansion — that bash-4 form aborts this script under set -e after a
  # successful route. Capitalize the first character with portable tools.
  ROLE_LABEL="$(printf '%s' "${ROLE:0:1}" | tr '[:lower:]' '[:upper:]')${ROLE:1}"
  echo "${ROLE_LABEL} inbox: $(ls -1t "${INBOX}"/*"_for_${ROLE}.handoff" | head -1)"
else
  echo "Warning: parcel not found in ${INBOX} — see .swarmforge/handoffs/inject-traffic.log" >&2
  exit 1
fi
