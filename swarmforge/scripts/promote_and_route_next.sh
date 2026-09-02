#!/usr/bin/env bash
# Promote one eligible paused ticket into backlog/active/ and route Work to coder.
#
# Usage:
#   promote_and_route_next.sh [project-root]
#   promote_and_route_next.sh [BL-id] [project-root]
#
# Gates:
#   - never promotes epics (type: epic), blocked-status, or tickets refused by
#     promotion_gates_cli.bb. Free prose never decides candidacy (BL-1100).
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
#   - BL-1173 deprecator freshness gate (Article 3.6): after pick, before
#     git-mv, consults node extension/out/tools/deprecate-check.js; hold or
#     CLI failure refuses and leaves the ticket in paused (fail-closed).
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
       promote_and_route_next.sh --list-candidates [project-root]

Promotes one eligible backlog/paused/*.yaml into backlog/active/, subject to
every promotion_gates gate (human_approval, expedite lane, depth,
orthogonality, hold marker), then routes via route_backlog_to_coder.sh —
to the specifier when assigned_to: specifier, to coder otherwise.

--list-candidates prints ticket ids that pass the structured epic/blocked
pre-filter (BL-1100), writing one "skip <id> gate=<gate>" line to stderr per
disqualified paused ticket. Does not promote.
EOF
}

LIST_CANDIDATES=0
if [[ "${1:-}" == "--list-candidates" ]]; then
  LIST_CANDIDATES=1
  shift
fi

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
if [[ "$LIST_CANDIDATES" -eq 0 ]] && (( CAP >= 0 )) && (( ACTIVE_COUNT >= CAP )); then
  echo "Error: active_backlog_max_depth gate: active count $ACTIVE_COUNT >= cap $CAP — no open slot" >&2
  exit 2
fi

is_epic_type() {
  local f="$1"
  grep -qE '^type:[[:space:]]*epic[[:space:]]*$' "$f" 2>/dev/null
}

is_blocked_status() {
  local f="$1"
  grep -qE '^status:[[:space:]]*blocked[[:space:]]*$' "$f" 2>/dev/null
}

# BL-1100: every auto-pick skip speaks — ticket id + which structured gate.
# Prose is never a gate (is_do_not_promote deleted).
ticket_id_of() {
  local f="$1"
  grep -E '^id:' "$f" | head -1 | awk '{print $2}' | tr -d '\r'
}

announce_skip() {
  local f="$1" gate="$2"
  local id
  id="$(ticket_id_of "$f")"
  [[ -n "$id" ]] || id="$(basename "$f")"
  echo "skip $id gate=$gate" >&2
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
  local candidates=()

  if [[ -n "$ITEM" ]]; then
    local located held
    located="$(bb "$SCRIPT_DIR/promotion_gates_cli.bb" locate "$ROOT" "$ITEM")" || {
      echo "Error: no paused or held yaml for $ITEM" >&2
      return 1
    }
    f="${located%%$'\t'*}"
    held="${located##*$'\t'}"
    if is_epic_type "$f" || is_blocked_status "$f"; then
      echo "Error: $ITEM is epic or blocked" >&2
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
    if is_epic_type "$f"; then
      announce_skip "$f" "epic"
      continue
    fi
    if is_blocked_status "$f"; then
      announce_skip "$f" "blocked"
      continue
    fi
    # Never promote out of hold/ (hold is a sibling folder, not under paused)
    if [[ "$LIST_CANDIDATES" -eq 1 ]]; then
      ticket_id_of "$f"
      continue
    fi
    candidates+=("$f")
  done < <(find "$PAUSED_DIR" -maxdepth 1 -name '*.yaml' -type f 2>/dev/null | sort)

  if [[ "$LIST_CANDIDATES" -eq 1 ]]; then
    return 0
  fi

  # BL-1340 invariant 2. The whole eligible set goes to the ONE chokepoint,
  # in one call. This used to partition candidates into buildable[] and
  # other[] first and offer buildable[] alone, reaching other[] only if that
  # yielded nothing - which with ~100 paused tickets it never did. That
  # partition ran BEFORE `select`, so it silently outranked Article 3.2.4:
  # an expedited defect whose acceptance named a draft lost its place in the
  # lane to any non-expedited ticket that happened to be buildable, and
  # BL-663's own comment names promotion_gates_cli.bb as the one place that
  # ordering is decided. Buildability may break a tie WITHIN equal expedite
  # rank; it may never filter ahead of the ordering.
  local picked
  if ((${#candidates[@]} > 0)); then
    if picked="$(bb "$SCRIPT_DIR/promotion_gates_cli.bb" select "$ROOT" "$CAP" "${candidates[@]}")"; then
      echo "$picked"
      return 0
    fi
  fi
  echo "Error: no eligible paused ticket" >&2
  return 1
}

if [[ "$LIST_CANDIDATES" -eq 1 ]]; then
  pick_candidate || exit 1
  exit 0
fi

SRC="$(pick_candidate)" || exit 1
BASE="$(basename "$SRC")"
DEST="$ACTIVE_DIR/$BASE"
ID="$(grep -E '^id:' "$SRC" | head -1 | awk '{print $2}' | tr -d '\r')"

# BL-1173: deprecator freshness gate (Article 3.6). Fail-closed — CLI crash or
# malformed JSON is hold, never allow. On hold the ticket stays in paused and a
# priority-00 note reaches the specifier.
# BL-1267: ONE resolution of the CLI path, used by both the check and the
# interpreter below. They used to resolve it separately and the interpreter's
# copy was hardcoded to "$ROOT/extension/...", so against any root that is not
# this repo itself the check ran fine and the interpreter then failed closed on
# a missing module - a hold no adjudication could ever discharge, and the
# reason blamed the interpreter rather than the path.
resolve_deprecate_check_cli() {
  if [[ -f "$ROOT/extension/out/tools/deprecate-check.js" ]]; then
    printf '%s' "$ROOT/extension/out/tools/deprecate-check.js"
  elif [[ -f "$SCRIPT_DIR/../../extension/out/tools/deprecate-check.js" ]]; then
    printf '%s' "$(cd "$SCRIPT_DIR/../.." && pwd)/extension/out/tools/deprecate-check.js"
  fi
}

deprecate_check_cli() {
  local cli
  cli="$(resolve_deprecate_check_cli)"
  if [[ -z "$cli" || ! -f "$cli" ]]; then
    echo '{"decision":"hold","reason":"deprecate-check CLI missing — fail closed"}'
    return 0
  fi
  node "$cli" "$ROOT" "$ID" 2>/dev/null || echo '{"decision":"hold","reason":"deprecate-check CLI failed — fail closed"}'
}

notify_specifier_freshness_hold() {
  local reason="$1"
  local draft
  draft="$(mktemp)"
  cat > "$draft" <<EOF
type: note
to: specifier
priority: 00
task: ${ID}-deprecator-freshness-hold

Deprecator freshness gate HOLD for ${ID} at promote time.
Reason: ${reason}
Ticket remains in backlog/paused/. Adjudicate (amend / retire / split / confirm).
EOF
  if [[ -x "$SCRIPT_DIR/swarm_handoff.sh" ]]; then
    "$SCRIPT_DIR/swarm_handoff.sh" "$draft" 2>/dev/null || \
      echo "promote_and_route_next: freshness HOLD for ${ID}: ${reason} (specifier note send failed — reason printed here)" >&2
  else
    echo "promote_and_route_next: freshness HOLD for ${ID}: ${reason}" >&2
  fi
  rm -f "$draft"
}

FRESHNESS_RAW="$(deprecate_check_cli)"
# Interpret via the same pure fail-closed helper the property tests lock
# (BL-1173 inv 1) — never re-derive allow/hold in shell.
FRESHNESS_JSON="$(printf '%s' "$FRESHNESS_RAW" | node -e '
const { interpretFreshnessCliOutput } = require(process.argv[1]);
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify(interpretFreshnessCliOutput(raw)));
});
' "$(resolve_deprecate_check_cli)" 2>/dev/null || echo '{"decision":"hold","reason":"interpretFreshnessCliOutput failed — fail closed"}')"
FRESHNESS_DECISION="$(printf '%s' "$FRESHNESS_JSON" | sed -n 's/.*"decision"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
FRESHNESS_REASON="$(printf '%s' "$FRESHNESS_JSON" | sed -n 's/.*"reason"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
if [[ -z "$FRESHNESS_DECISION" || "$FRESHNESS_DECISION" == "hold" ]]; then
  REASON="${FRESHNESS_REASON:-malformed or missing deprecate-check output — fail closed}"
  if [[ -z "$FRESHNESS_DECISION" ]]; then
    REASON="malformed deprecate-check output — fail closed"
  fi
  notify_specifier_freshness_hold "$REASON"
  echo "Error: deprecator freshness gate: HOLD for ${ID}: ${REASON}" >&2
  exit 2
fi

# BL-1028: snapshot what this promotion is about to stage, BEFORE staging it,
# so a refused integrity commit can be unwound exactly. Scoped to the two
# paths this script stages itself - never a blanket `git reset`, which on the
# shared master checkout every role commits from would discard other roles'
# staged work.
PROMOTION_SNAPSHOT_DIR="$(mktemp -d)"
trap 'rm -rf "$PROMOTION_SNAPSHOT_DIR"' EXIT
git -C "$ROOT" ls-files --stage -- "backlog/paused/$BASE" "backlog/active/$BASE" \
  > "$PROMOTION_SNAPSHOT_DIR/index" 2>/dev/null || : > "$PROMOTION_SNAPSHOT_DIR/index"
cp "$SRC" "$PROMOTION_SNAPSHOT_DIR/src"

# Puts the index and the working tree back exactly as they were before the
# `git mv` below - including the assigned_to rewrite, which edits $DEST in
# the working tree after the rename is staged.
rollback_promotion() {
  git -C "$ROOT" update-index --force-remove -- \
    "backlog/paused/$BASE" "backlog/active/$BASE" 2>/dev/null || true
  if [[ -s "$PROMOTION_SNAPSHOT_DIR/index" ]]; then
    git -C "$ROOT" update-index --index-info < "$PROMOTION_SNAPSHOT_DIR/index" 2>/dev/null || true
  fi
  rm -f "$DEST"
  cp "$PROMOTION_SNAPSHOT_DIR/src" "$SRC"
}

# The CLI refuses in two shapes and they do not look alike. A :success-false
# refusal prints the raw result JSON on stdout and a `FAILED (reason)` line on
# stderr; a close-guard rejection exits before commit-with-integrity! ever
# runs, so it prints ONLY a `CLOSE BLOCKED` line and no JSON at all. Reading
# just one of them would report `unknown` for the other.
integrity_refusal_reason() {
  local out="$1" err="$2" reason=""
  if grep -q 'CLOSE BLOCKED' "$err" 2>/dev/null; then
    printf '%s\n' close-guard
    return 0
  fi
  reason="$(sed -n 's/.*"reason":"\([^"]*\)".*/\1/p' "$out" 2>/dev/null | head -1)"
  if [[ -z "$reason" ]]; then
    reason="$(sed -n 's/.*FAILED (\([^)]*\)).*/\1/p' "$err" 2>/dev/null | head -1)"
  fi
  printf '%s\n' "${reason:-unknown}"
}

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

# Commit via integrity helper when available.
#
# BL-1028: a refusal is OBEYED, never overridden. The old `|| { git add;
# git commit; }` fired only when the CLI was PRESENT and REFUSED, so its
# entire job was to override refusals - including :lock-timeout and
# :verify-mismatch, which mean a concurrent writer is live in the shared
# checkout, i.e. exactly what the lock exists to serialise. commit_integrity's
# own header says callers must commit through it "never a hand-rolled `git
# commit` that would race the roles committing to main"; that fallback did
# precisely that, in the one case where it was most dangerous. And when the
# fallback itself failed, the `git mv` above stayed staged in the shared index
# with nothing to unwind it.
if [[ -f "$SCRIPT_DIR/commit_integrity_cli.bb" ]]; then
  INTEGRITY_RC=0
  bb "$SCRIPT_DIR/commit_integrity_cli.bb" "$ROOT" \
    --message "Promote ${ID}: paused → active for ${ROUTE_ROLE}" \
    --path "backlog/paused/$BASE" \
    --path "backlog/active/$BASE" \
    > "$PROMOTION_SNAPSHOT_DIR/integrity.out" \
    2> "$PROMOTION_SNAPSHOT_DIR/integrity.err" || INTEGRITY_RC=$?
  # The CLI's own output still reaches the caller either way - obeying a
  # refusal must not also make it quieter than the old bypass was.
  cat "$PROMOTION_SNAPSHOT_DIR/integrity.out"
  cat "$PROMOTION_SNAPSHOT_DIR/integrity.err" >&2
  if (( INTEGRITY_RC != 0 )); then
    REFUSAL_REASON="$(integrity_refusal_reason \
      "$PROMOTION_SNAPSHOT_DIR/integrity.out" "$PROMOTION_SNAPSHOT_DIR/integrity.err")"
    rollback_promotion
    echo "promote_and_route_next: integrity commit REFUSED (${REFUSAL_REASON}) for ${ID} — rolled the staged paused → active rename back; ${BASE} is still in backlog/paused/ for the next attempt. NOT overriding a refusal with a raw commit." >&2
    exit 1
  fi
else
  # Deliberate degradation for a target repo that never had the guard - not a
  # refusal path. It says so out loud so an unguarded commit is never mistaken
  # for a guarded one.
  git -C "$ROOT" add -A "backlog/active/$BASE"
  git -C "$ROOT" add -u "backlog/paused/$BASE" 2>/dev/null || true
  git -C "$ROOT" commit -m "Promote ${ID}: paused → active for ${ROUTE_ROLE}"
  echo "promote_and_route_next: no commit_integrity_cli.bb in this target — committed WITHOUT the integrity guard." >&2
fi

echo "Promoted $BASE → backlog/active/ (assigned_to: ${ROUTE_ROLE})"

# BL-1097: the router now refuses to originate a parcel for a ticket that
# already has a dispatch trail (exit 3). Under set -e that would abort here
# with no explanation, right after a promotion that DID land - and "promote
# without route strands the resident on NO_TASK" (PIPELINE.md step 6), so the
# coordinator has to be told exactly what state it is in. A freshly promoted
# ticket has no trail and is unaffected; the case that reaches this branch is a
# re-promotion of work that was already dispatched once.
ROUTE_RC=0
"$SCRIPT_DIR/route_backlog_to_coder.sh" "$ID" "$ROOT" || ROUTE_RC=$?
if (( ROUTE_RC == 3 )); then
  echo "promote_and_route_next: ${ID} was promoted into backlog/active/ but the router REFUSED to route it — it already has a dispatch trail (BL-1097). The promotion stands; nothing was sent. Either close ${ID} (move it to backlog/done/) or re-route deliberately with: route_backlog_to_coder.sh --force ${ID}" >&2
  exit 3
elif (( ROUTE_RC != 0 )); then
  exit "$ROUTE_RC"
fi

# Best-effort BL-464 stage sync
if [[ -f "$SCRIPT_DIR/pipeline_stage_cli.bb" ]]; then
  bb "$SCRIPT_DIR/pipeline_stage_cli.bb" "$ROOT" sync >/dev/null 2>&1 || true
fi

# BL-1228: after a successful promotion, surface any ticket ALREADY in
# backlog/active/ under a standing freshness hold (the BL-419 shape a
# hand-rolled promotion that bypasses this script would otherwise leave
# unreported indefinitely). Report only - never gates or reverts THIS
# promotion, which has already landed; output is left visible, not
# suppressed, so a coordinator/human watching this run sees it.
if [[ -f "$SCRIPT_DIR/active_pool_freshness_audit.sh" ]]; then
  "$SCRIPT_DIR/active_pool_freshness_audit.sh" "$ROOT" || true
fi

# BL-1261: after a successful promotion, surface any ticket in backlog/hold/
# whose parcel is still moving in a role's mailbox (the expeditor park
# divergence). Report only - never moves tickets or parcels, never gates or
# reverts THIS promotion. Output is left visible so a coordinator/human
# watching this run sees it.
if [[ -f "$SCRIPT_DIR/hold_divergence_audit_cli.bb" ]]; then
  bb "$SCRIPT_DIR/hold_divergence_audit_cli.bb" "$ROOT" || true
fi

echo "Promote+route complete for $ID"
