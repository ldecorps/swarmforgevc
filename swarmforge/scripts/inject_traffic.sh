#!/usr/bin/env bash
# List recent tmux handoff injection traffic (sync-deliver + handoffd daemon).
#
# Usage:
#   ./swarmforge/scripts/inject_traffic.sh [project-root] [-n COUNT] [--follow]
#
# Reads:
#   .swarmforge/handoffs/inject-traffic.log  (phase-1 sync deliver + inject lib)
#   .swarmforge/daemon/handoffd.log           (daemon deliver / notify failures)
#
# Exit 0 always; use OUTCOME column and summary counts to judge health.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() {
  cat <<'EOF'
Usage: inject_traffic.sh [project-root] [-n COUNT] [--follow]

Show the most recent tmux wake/injection events for handoff delivery.

Options:
  -n COUNT   Show last COUNT events (default: 25)
  --follow   Tail inject-traffic.log live (daemon log not followed)
  -h         This help

Log file (append-only, created on first sync inject):
  .swarmforge/handoffs/inject-traffic.log
EOF
}

resolve_project_root() {
  local candidate="${1:-$PWD}"
  candidate="$(cd "$candidate" && pwd)"
  if [[ -f "$candidate/.swarmforge/roles.tsv" ]]; then
    echo "$candidate"
    return 0
  fi
  if git -C "$candidate" rev-parse --show-toplevel &>/dev/null; then
    local root
    root="$(git -C "$candidate" rev-parse --show-toplevel)"
    if [[ -f "$root/.swarmforge/roles.tsv" ]]; then
      echo "$root"
      return 0
    fi
  fi
  echo "Error: cannot find SwarmForge project root (missing .swarmforge/roles.tsv)" >&2
  return 1
}

LIMIT=25
FOLLOW=0
PROJECT_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n)
      LIMIT="${2:?missing count for -n}"
      shift 2
      ;;
    --follow|-f)
      FOLLOW=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      PROJECT_ARG="$1"
      shift
      ;;
  esac
done

ROOT="$(resolve_project_root "${PROJECT_ARG:-$PWD}")"
STATE_DIR="$ROOT/.swarmforge"
HANDOFFS_DIR="$STATE_DIR/handoffs"
INJECT_LOG="$HANDOFFS_DIR/inject-traffic.log"
DAEMON_LOG="$STATE_DIR/daemon/handoffd.log"
ROLES_FILE="$STATE_DIR/roles.tsv"
TMUX_SOCKET_FILE="$STATE_DIR/tmux-socket"

session_for_role() {
  local role="$1"
  awk -F'\t' -v r="$role" '$1 == r { print $4; exit }' "$ROLES_FILE" 2>/dev/null || true
}

count_files() {
  local dir="$1"
  local pattern="${2:-*.handoff}"
  if [[ ! -d "$dir" ]]; then
    echo 0
    return
  fi
  find "$dir" -maxdepth 1 -type f -name "$pattern" 2>/dev/null | wc -l | tr -d ' '
}

if [[ "$FOLLOW" == 1 ]]; then
  echo "Following $INJECT_LOG (Ctrl-C to stop)"
  if [[ ! -f "$INJECT_LOG" ]]; then
    touch "$INJECT_LOG"
  fi
  tail -n "$LIMIT" -f "$INJECT_LOG"
  exit 0
fi

TMP_EVENTS="$(mktemp)"
trap 'rm -f "$TMP_EVENTS"' EXIT

# inject-traffic.log lines are already: TIMESTAMP key=value ...
if [[ -f "$INJECT_LOG" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    echo "$line" >> "$TMP_EVENTS"
  done < "$INJECT_LOG"
fi

# Normalize handoffd.log injection-related lines into the same shape.
if [[ -f "$DAEMON_LOG" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    local_ts="${line%% *}"
    rest="${line#"$local_ts "}"

    case "$rest" in
      delivered\ *)
        path="${rest#delivered }"
        parcel="$(basename "$path")"
        echo "$local_ts source=handoffd outcome=ok parcel=$parcel detail=daemon-delivered" >> "$TMP_EVENTS"
        ;;
      notify-delivery-failed\ *)
        # notify-delivery-failed <session> <detail...>
        payload="${rest#notify-delivery-failed }"
        session="${payload%% *}"
        detail="${payload#"$session "}"
        role=""
        if [[ -f "$ROLES_FILE" ]]; then
          role="$(awk -F'\t' -v s="$session" '$4 == s { print $1; exit }' "$ROLES_FILE")"
        fi
        echo "$local_ts source=handoffd outcome=failed session=$session role=${role:-?} detail=$detail" >> "$TMP_EVENTS"
        ;;
      startup-notify\ *)
        role="${rest#startup-notify }"
        session="$(session_for_role "$role")"
        echo "$local_ts source=handoffd-startup outcome=wake role=$role session=${session:-?} detail=startup-notify-pending" >> "$TMP_EVENTS"
        ;;
      startup-notify-error\ *)
        payload="${rest#startup-notify-error }"
        role="${payload%% *}"
        detail="${payload#"$role "}"
        session="$(session_for_role "$role")"
        echo "$local_ts source=handoffd-startup outcome=error role=$role session=${session:-?} detail=$detail" >> "$TMP_EVENTS"
        ;;
      chase-wake-error\ *)
        payload="${rest#chase-wake-error }"
        role="${payload%% *}"
        detail="${payload#"$role "}"
        session="$(session_for_role "$role")"
        echo "$local_ts source=handoffd-chase outcome=failed role=$role session=${session:-?} detail=$detail" >> "$TMP_EVENTS"
        ;;
    esac
  done < "$DAEMON_LOG"
fi

printf '\nSwarmForge tmux injection traffic\n'
printf 'Project: %s\n' "$ROOT"

if [[ -f "$TMUX_SOCKET_FILE" ]]; then
  printf 'Tmux socket: %s\n' "$(<"$TMUX_SOCKET_FILE")"
else
  printf 'Tmux socket: (none — swarm not running?)\n'
fi

if [[ -f "$STATE_DIR/daemon/handoffd.pid" ]]; then
  pid="$(<"$STATE_DIR/daemon/handoffd.pid")"
  if kill -0 "$pid" 2>/dev/null; then
    printf 'Handoff daemon: running (pid %s)\n' "$pid"
  else
    printf 'Handoff daemon: stale pid file (%s)\n' "$pid"
  fi
else
  printf 'Handoff daemon: not running (phase-1 sync inject expected)\n'
fi

outbox_pending="$(count_files "$HANDOFFS_DIR/outbox" '*.handoff')"
outbox_errors="$(count_files "$HANDOFFS_DIR/outbox" '*.handoff.error')"
inbox_new=0
if [[ -d "$HANDOFFS_DIR" ]]; then
  inbox_new="$(find "$HANDOFFS_DIR" -path '*/inbox/new/*.handoff' 2>/dev/null | wc -l | tr -d ' ')"
fi

ok_count=0
fail_count=0
if [[ -s "$TMP_EVENTS" ]]; then
  ok_count="$(grep -c 'outcome=ok' "$TMP_EVENTS" 2>/dev/null || true)"
  fail_count="$(grep -Ec 'outcome=(failed|error)' "$TMP_EVENTS" 2>/dev/null || true)"
fi

printf 'Outbox pending: %s | outbox errors: %s | inbox/new parcels: %s\n' \
  "$outbox_pending" "$outbox_errors" "$inbox_new"
printf 'Logged injections: %s ok | %s failed/error\n' "$ok_count" "$fail_count"
printf '\n'

if [[ ! -s "$TMP_EVENTS" ]]; then
  cat <<EOF
(no injection events logged yet)

Tips:
  - Phase-1 (SWARMFORGE_SKIP_DAEMON=1): events appear after swarm_handoff.sh
    delivers a parcel. Log: $INJECT_LOG
  - Phase-2 (handoffd): also check $DAEMON_LOG
  - Send a test note handoff from coordinator to coder, then re-run this script.
EOF
  exit 0
fi

printf 'Last %s events (newest first):\n\n' "$LIMIT"
printf '%-27s %-16s %-8s %-24s %-36s %s\n' "TIME" "SOURCE" "OUTCOME" "ROLE/SESSION" "PARCEL" "DETAIL"
printf '%.0s-' {1..120}; printf '\n'

sort -r "$TMP_EVENTS" | head -n "$LIMIT" | while IFS= read -r line; do
  ts="${line%% *}"
  rest="${line#"$ts "}"

  source=""; outcome=""; role=""; session=""; parcel=""; detail=""
  stacked=""

  if [[ "$rest" == *detail=* ]]; then
    detail="${rest#*detail=}"
    rest="${rest% detail=*}"
    rest="${rest%% }"
  fi

  # shellcheck disable=SC2086
  for token in $rest; do
    key="${token%%=*}"
    value="${token#*=}"
    case "$key" in
      source) source="$value" ;;
      outcome) outcome="$value" ;;
      role) role="$value" ;;
      session) session="$value" ;;
      parcel) parcel="$value" ;;
      detail) : ;;  # captured above
      stacked) stacked="$value" ;;
      attempts)
        if [[ -n "$detail" ]]; then
          detail="attempts=$value $detail"
        else
          detail="attempts=$value"
        fi
        ;;
    esac
  done

  role_sess="${role:-?}"
  if [[ -n "$session" && "$session" != "?" ]]; then
    if [[ "$role_sess" == "?" ]]; then
      role_sess="$session"
    else
      role_sess="$role_sess/$session"
    fi
  fi

  if [[ -n "$stacked" ]]; then
    if [[ -n "$detail" ]]; then
      detail="$detail stacked=$stacked"
    else
      detail="stacked=$stacked"
    fi
  fi

  # Trim parcel basename for display
  if [[ ${#parcel} -gt 34 ]]; then
    parcel="…${parcel: -33}"
  fi

  printf '%-27s %-16s %-8s %-24s %-36s %s\n' \
    "$ts" "$source" "$outcome" "$role_sess" "$parcel" "$detail"
done

printf '\n'
if [[ "$fail_count" -gt 0 ]]; then
  printf '⚠ %s failed/error injection(s) in log history — check DETAIL column.\n' "$fail_count"
elif [[ "$ok_count" -gt 0 ]]; then
  printf '✓ Recent injections include successful tmux submits (outcome=ok).\n'
fi

if [[ "$outbox_pending" -gt 0 ]]; then
  printf '⚠ %s parcel(s) still in outbox — delivery may be stuck or daemon disabled.\n' "$outbox_pending"
fi

if [[ "$outbox_errors" -gt 0 ]]; then
  printf '⚠ %s outbox .error stub(s) — inspect %s/outbox/*.handoff.error\n' "$outbox_errors" "$HANDOFFS_DIR"
fi
