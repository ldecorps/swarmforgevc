#!/usr/bin/env bash
# Promote one eligible paused ticket into backlog/active/ and route Work to coder.
#
# Usage:
#   promote_and_route_next.sh [project-root]
#   promote_and_route_next.sh [BL-id] [project-root]
#
# Gates:
#   - never promotes epics tagged do-not-promote in notes, blocked-status, or
#     epic-type items
#   - prefers buildable paused (acceptance: or matching feature file) in
#     priority/id order, but see promotion_gates below for the real ranking
#   - promotion_gates (BL-663; promotion_gates_cli.bb / promotion_gates_lib.bb)
#     is the one chokepoint for: human_approval, Article 3.2.4 expedite
#     ordering, active_backlog_max_depth, and the hold marker — every
#     promotion (auto-pick AND by-name) is refused with a named reason when
#     any of these do not hold. Orthogonality (BL-854) never refuses; it
#     prints an ADVISORY|orthogonality|... line to stderr instead, naming
#     every active ticket sharing the candidate's epic — see gates_evaluate
#     below for why that reaches this script's own stderr unmodified.
#   - assignee/spec-stage routing also goes through promotion_gates:
#     assigned_to: specifier is never rewritten and routes to the specifier;
#     every other ticket routes to coder via route_backlog_to_coder.sh
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

Promotes one eligible backlog/paused/*.yaml into backlog/active/, subject to
every promotion_gates gate (human_approval, expedite lane, depth,
orthogonality, hold marker), then routes via route_backlog_to_coder.sh —
to the specifier when assigned_to: specifier, to coder otherwise.
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

# Create early, before ACTIVE_COUNT below: `find` on a missing dir exits
# non-zero, and under `set -o pipefail` that silently kills this whole
# script via errexit (2>/dev/null hides the real "No such file or
# directory" cause) — exactly the invisible-refusal failure mode BL-663
# exists to close. A fresh checkout with no promotion yet has no
# backlog/active/ at all.
mkdir -p "$ACTIVE_DIR"

# Effective depth cap (Article 3.5 / BL-432 folds auto-throttle when present).
# BL-853: -1 (or any negative value) is the documented no-limit sentinel,
# never a real ceiling - accept a SIGNED integer at every step (the
# unsigned ^[0-9]+$ check used to discard the sentinel as "malformed" and
# fall through to a tighter cap no operator configured). This script parses
# no config and declares no depth default of its own: every value below
# comes from the shared depth library via its own CLIs, and the one literal
# fallback at the very end mirrors backlog-depth-lib/default-max-depth for
# the sole case where bb itself cannot be run at all.
CAP=""
if [[ -f "$SCRIPT_DIR/effective_backlog_depth_cli.bb" ]]; then
  CAP="$(bb "$SCRIPT_DIR/effective_backlog_depth_cli.bb" "$ROOT" 2>/dev/null | tr -d '[:space:]' || true)"
fi
if [[ -z "$CAP" || ! "$CAP" =~ ^-?[0-9]+$ ]]; then
  CONF_PATH="$(bb "$SCRIPT_DIR/backlog_depth_conf_path_cli.bb" "$ROOT" 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ -n "$CONF_PATH" ]]; then
    CAP="$(bb "$SCRIPT_DIR/backlog_depth_cli.bb" "$CONF_PATH" 2>/dev/null | tr -d '[:space:]' || true)"
  fi
fi
if [[ -z "$CAP" || ! "$CAP" =~ ^-?[0-9]+$ ]]; then
  CAP=5
fi

ACTIVE_COUNT="$(find "$ACTIVE_DIR" -maxdepth 1 -name '*.yaml' -type f 2>/dev/null | wc -l | tr -d '[:space:]')"
if (( CAP >= 0 )) && (( ACTIVE_COUNT >= CAP )); then
  echo "Error: active_backlog_max_depth gate: active count $ACTIVE_COUNT >= cap $CAP — no open slot" >&2
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

# promotion_gates: the BL-663 chokepoint (promotion_gates_cli.bb) is the ONE
# place human_approval / Article 3.2.4 expedite ordering / depth /
# orthogonality / hold marker are decided — both invocation modes below call
# it, never a locally-reimplemented check. BL-854: promotion_gates_cli.bb
# writes any orthogonality ADVISORY line to ITS OWN stderr, never stdout —
# neither call site below redirects stderr, so command substitution
# ($(...), which only ever captures stdout) leaves that ADVISORY line to
# fall straight through to this script's own stderr (and whatever is
# watching it — operator terminal, coordinator log) unmodified. That is what
# "print the advisory for the ticket it actually promotes" means here: do
# not add a `2>...` redirect to any promotion_gates_cli.bb call below, or
# the advisory goes dark exactly where the file-overlap judgement is made.
gates_evaluate() {
  local file="$1" held="$2"
  bb "$SCRIPT_DIR/promotion_gates_cli.bb" evaluate "$ROOT" "$file" "$held" "$CAP"
}

pick_candidate() {
  local f
  local buildable=()
  local other=()

  if [[ -n "$ITEM" ]]; then
    local located held
    located="$(bb "$SCRIPT_DIR/promotion_gates_cli.bb" locate "$ROOT" "$ITEM")" || {
      echo "Error: no paused or held yaml for $ITEM" >&2
      return 1
    }
    f="${located%%$'\t'*}"
    held="${located##*$'\t'}"
    if is_do_not_promote "$f" || is_epic_type "$f" || is_blocked_status "$f"; then
      echo "Error: $ITEM is do-not-promote, epic, or blocked" >&2
      return 1
    fi
    local held_bool="false"
    [[ "$held" == "hold" ]] && held_bool="true"
    local verdict
    verdict="$(gates_evaluate "$f" "$held_bool")" || {
      local gate="${verdict#REFUSE|}"; gate="${gate%%|*}"
      local reason="${verdict##*|}"
      echo "Error: $gate gate: $reason" >&2
      return 1
    }
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
      buildable+=("$f")
    else
      other+=("$f")
    fi
  done < <(find "$PAUSED_DIR" -maxdepth 1 -name '*.yaml' -type f 2>/dev/null | sort)

  local picked
  if ((${#buildable[@]} > 0)); then
    if picked="$(bb "$SCRIPT_DIR/promotion_gates_cli.bb" select "$ROOT" "$CAP" "${buildable[@]}")"; then
      echo "$picked"
      return 0
    fi
  fi
  if ((${#other[@]} > 0)); then
    if picked="$(bb "$SCRIPT_DIR/promotion_gates_cli.bb" select "$ROOT" "$CAP" "${other[@]}")"; then
      echo "$picked"
      return 0
    fi
  fi
  echo "Error: no eligible paused ticket" >&2
  return 1
}

SRC="$(pick_candidate)" || exit 1
BASE="$(basename "$SRC")"
DEST="$ACTIVE_DIR/$BASE"
ID="$(grep -E '^id:' "$SRC" | head -1 | awk '{print $2}' | tr -d '\r')"

git -C "$ROOT" mv "$SRC" "$DEST"

# promotion_gates: assignee/spec-stage routing decision — assigned_to:
# specifier is never rewritten (BL-663 instance 3); every other value is
# corrected to coder only when it does not already read coder.
ROUTE_DECISION="$(bb "$SCRIPT_DIR/promotion_gates_cli.bb" route-target "$ROOT" "$DEST")"
ROUTE_ROLE="${ROUTE_DECISION%% *}"
ROUTE_FLAG="${ROUTE_DECISION##* }"
if [[ "$ROUTE_FLAG" == "REWRITE" ]]; then
  if grep -qE '^assigned_to:' "$DEST"; then
    # `sed -i` takes a mandatory suffix operand on BSD/macOS but forbids one
    # (with no space) on GNU — no single invocation satisfies both. Route
    # through a temp file and `cat` back in place instead: identical output
    # on both sed flavors, and writing into the existing $DEST (rather than
    # `mv`-ing a fresh mktemp file over it) keeps its original mode bits.
    SED_TMP="$(mktemp)"
    sed "s/^assigned_to:.*/assigned_to: ${ROUTE_ROLE}/" "$DEST" > "$SED_TMP"
    cat "$SED_TMP" > "$DEST"
    rm -f "$SED_TMP"
  else
    printf '\nassigned_to: %s\n' "$ROUTE_ROLE" >> "$DEST"
  fi
fi

# Commit via integrity helper when available
if [[ -f "$SCRIPT_DIR/commit_integrity_cli.bb" ]]; then
  bb "$SCRIPT_DIR/commit_integrity_cli.bb" "$ROOT" \
    --message "Promote ${ID}: paused → active for ${ROUTE_ROLE}" \
    --path "backlog/paused/$BASE" \
    --path "backlog/active/$BASE" \
    || {
      git -C "$ROOT" add -A "backlog/active/$BASE"
      git -C "$ROOT" add -u "backlog/paused/$BASE" 2>/dev/null || true
      git -C "$ROOT" commit -m "Promote ${ID}: paused → active for ${ROUTE_ROLE}"
    }
else
  git -C "$ROOT" add -A "backlog/active/$BASE"
  git -C "$ROOT" add -u "backlog/paused/$BASE" 2>/dev/null || true
  git -C "$ROOT" commit -m "Promote ${ID}: paused → active for ${ROUTE_ROLE}"
fi

echo "Promoted $BASE → backlog/active/ (assigned_to: ${ROUTE_ROLE})"
"$SCRIPT_DIR/route_backlog_to_coder.sh" "$ID" "$ROOT"

# Best-effort BL-464 stage sync
if [[ -f "$SCRIPT_DIR/pipeline_stage_cli.bb" ]]; then
  bb "$SCRIPT_DIR/pipeline_stage_cli.bb" "$ROOT" sync >/dev/null 2>&1 || true
fi

echo "Promote+route complete for $ID"
