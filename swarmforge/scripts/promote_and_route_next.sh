#!/usr/bin/env bash
# Promote one eligible paused ticket into backlog/active/ and route Work to coder.
#
# Usage:
#   promote_and_route_next.sh [project-root]
#   promote_and_route_next.sh [BL-id] [project-root]
#
# Gates:
#   - aborts if active yaml count >= effective depth cap
#   - skips hold/; prefers buildable paused (acceptance: or matching feature
#     file) in priority/id order
#   - never promotes epics tagged do-not-promote in notes
#   - sets assigned_to: coder and calls route_backlog_to_coder.sh
#
# Coordinator-owned intake: the daemon may nudge this script; it must not
# git-mv paused→active itself (no BL-226 receive-path auto-promote).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() {
  cat <<'EOF'
Usage: promote_and_route_next.sh [BL-id] [project-root]
       promote_and_route_next.sh [project-root]

Promotes one eligible backlog/paused/*.yaml into backlog/active/ (under the
effective depth cap), sets assigned_to: coder, and routes via
route_backlog_to_coder.sh.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ITEM=""
ROOT=""

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

ACTIVE_DIR="$ROOT/backlog/active"
PAUSED_DIR="$ROOT/backlog/paused"
HOLD_DIR="$ROOT/backlog/hold"

if [[ ! -d "$PAUSED_DIR" ]]; then
  echo "Error: no paused dir at $PAUSED_DIR" >&2
  exit 1
fi

# Effective depth cap (Article 3.5 / BL-432 folds auto-throttle when present).
CAP=""
if [[ -f "$SCRIPT_DIR/effective_backlog_depth_cli.bb" ]]; then
  CAP="$(bb "$SCRIPT_DIR/effective_backlog_depth_cli.bb" "$ROOT" 2>/dev/null | tr -d '[:space:]' || true)"
fi
if [[ -z "$CAP" || ! "$CAP" =~ ^[0-9]+$ ]]; then
  CAP="$(bb "$SCRIPT_DIR/backlog_depth_cli.bb" "$ROOT" 2>/dev/null | tr -d '[:space:]' || echo 1)"
fi
if [[ -z "$CAP" || ! "$CAP" =~ ^[0-9]+$ ]]; then
  CAP=1
fi

ACTIVE_COUNT="$(find "$ACTIVE_DIR" -maxdepth 1 -name '*.yaml' -type f 2>/dev/null | wc -l | tr -d '[:space:]')"
if (( ACTIVE_COUNT >= CAP )); then
  echo "Error: active count $ACTIVE_COUNT >= cap $CAP — no open slot" >&2
  exit 2
fi

is_do_not_promote() {
  local f="$1"
  grep -qiE 'do-not-promote|do not promote|DO NOT PROMOTE' "$f" 2>/dev/null
}

is_epic_type() {
  local f="$1"
  grep -qE '^type:[[:space:]]*epic[[:space:]]*$' "$f" 2>/dev/null
}

is_blocked_status() {
  local f="$1"
  grep -qE '^status:[[:space:]]*blocked[[:space:]]*$' "$f" 2>/dev/null
}

is_buildable() {
  local f="$1"
  local id
  id="$(grep -E '^id:' "$f" | head -1 | awk '{print $2}' | tr -d '\r')"
  if grep -qE '^acceptance:' "$f"; then
    # acceptance may be a path on the next line or inline
    local acc
    acc="$(awk '/^acceptance:/{if ($2!="") {print $2; exit} getline; gsub(/^[ \t]+/,"",$0); print; exit}' "$f")"
    if [[ -n "$acc" && -f "$ROOT/$acc" ]]; then
      return 0
    fi
    if [[ -n "$acc" && -f "$acc" ]]; then
      return 0
    fi
  fi
  if [[ -n "$id" ]] && compgen -G "$ROOT/specs/features/${id}-*.feature" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

ticket_priority() {
  local f="$1" raw
  raw="$(awk -F': *' '/^priority:[[:space:]]*/{print $2; exit}' "$f" 2>/dev/null | tr -d '\r')"
  if [[ "$raw" =~ ^[0-9]+$ ]]; then
    printf '%d' "$((10#$raw))"
  else
    printf '%d' 999999
  fi
}

ticket_id() {
  local f="$1" id
  id="$(grep -E '^id:' "$f" | head -1 | awk '{print $2}' | tr -d '\r')"
  if [[ -n "$id" ]]; then
    printf '%s' "$id"
  else
    basename "$f" .yaml
  fi
}

candidate_sort_line() {
  local f="$1"
  printf '%s\t%s\t%s\n' "$(ticket_priority "$f")" "$(ticket_id "$f")" "$f"
}

pick_lowest_sort_line() {
  sort -t $'\t' -k1,1n -k2,2 <<<"$1" | head -1 | cut -f3-
}

pick_candidate() {
  local f
  local buildable=()
  local other=()

  if [[ -n "$ITEM" ]]; then
    f="$(find "$PAUSED_DIR" -maxdepth 1 -name "${ITEM}*.yaml" -type f 2>/dev/null | head -1)"
    if [[ -z "$f" || ! -f "$f" ]]; then
      echo "Error: no paused yaml for $ITEM" >&2
      return 1
    fi
    if is_do_not_promote "$f" || is_epic_type "$f" || is_blocked_status "$f"; then
      echo "Error: $ITEM is do-not-promote, epic, or blocked" >&2
      return 1
    fi
    echo "$f"
    return 0
  fi

  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    is_do_not_promote "$f" && continue
    is_epic_type "$f" && continue
    is_blocked_status "$f" && continue
    # Never promote out of hold/ (hold is a sibling folder, not under paused)
    if is_buildable "$f"; then
      buildable+=("$(candidate_sort_line "$f")")
    else
      other+=("$(candidate_sort_line "$f")")
    fi
  done < <(find "$PAUSED_DIR" -maxdepth 1 -name '*.yaml' -type f 2>/dev/null | sort)

  if ((${#buildable[@]} > 0)); then
    pick_lowest_sort_line "$(printf '%s\n' "${buildable[@]}")"
    return 0
  fi
  if ((${#other[@]} > 0)); then
    pick_lowest_sort_line "$(printf '%s\n' "${other[@]}")"
    return 0
  fi
  echo "Error: no eligible paused ticket" >&2
  return 1
}

SRC="$(pick_candidate)" || exit 1
BASE="$(basename "$SRC")"
DEST="$ACTIVE_DIR/$BASE"
ID="$(grep -E '^id:' "$SRC" | head -1 | awk '{print $2}' | tr -d '\r')"

mkdir -p "$ACTIVE_DIR"
git -C "$ROOT" mv "$SRC" "$DEST"

# assigned_to: coder
if grep -qE '^assigned_to:' "$DEST"; then
  sed -i 's/^assigned_to:.*/assigned_to: coder/' "$DEST"
else
  printf '\nassigned_to: coder\n' >> "$DEST"
fi

# Commit via integrity helper when available
if [[ -f "$SCRIPT_DIR/commit_integrity_cli.bb" ]]; then
  bb "$SCRIPT_DIR/commit_integrity_cli.bb" "$ROOT" \
    --message "Promote ${ID}: paused → active for coder" \
    --path "backlog/paused/$BASE" \
    --path "backlog/active/$BASE" \
    || {
      git -C "$ROOT" add -A "backlog/active/$BASE"
      git -C "$ROOT" add -u "backlog/paused/$BASE" 2>/dev/null || true
      git -C "$ROOT" commit -m "Promote ${ID}: paused → active for coder"
    }
else
  git -C "$ROOT" add -A "backlog/active/$BASE"
  git -C "$ROOT" add -u "backlog/paused/$BASE" 2>/dev/null || true
  git -C "$ROOT" commit -m "Promote ${ID}: paused → active for coder"
fi

echo "Promoted $BASE → backlog/active/ (assigned_to: coder)"
"$SCRIPT_DIR/route_backlog_to_coder.sh" "$ID" "$ROOT"

# Best-effort BL-464 stage sync
if [[ -f "$SCRIPT_DIR/pipeline_stage_cli.bb" ]]; then
  bb "$SCRIPT_DIR/pipeline_stage_cli.bb" "$ROOT" sync >/dev/null 2>&1 || true
fi

echo "Promote+route complete for $ID"
