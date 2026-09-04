#!/usr/bin/env bash
# BL-1363: closing a ticket is one command - the mirror of
# promote_and_route_next.sh, which has been a script since BL-1028 while its
# closing half was performed by hand after every approval.
#
# Measured over 45 days: 484 promotion commits carry that script's generated
# subject; 409 close commits are hand-made, in two different spellings, and the
# destination drifted with them (665 loose ticket files in backlog/done/ beside
# 516 in milestone directories). Human ruling 2026-09-04: new closes settle
# into the milestone directory and the 665 are left alone.
#
# Article 2.6 is why this matters beyond tidiness: when one approved commit
# satisfies several tickets, every id moves or none does, because an id that
# never reaches done/ stays active forever.
#
# It does NOT promote (invariant 3): the follow-on promotion stays
# promote_and_route_next.sh's, so a refused close can never strand a promoted
# ticket on NO_TASK.
#
# Usage: close_ticket.sh <repo-root> <BL-id> [<BL-id> ...]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-}"
shift || true

if [[ -z "$ROOT" || $# -eq 0 ]]; then
  echo "Usage: close_ticket.sh <repo-root> <BL-id> [<BL-id> ...]" >&2
  exit 2
fi

IDS=("$@")

# ── Resolve every id BEFORE touching anything (invariant 2) ────────────────
# A partial close is worse than no close: the id that did not move stays
# active forever with nobody looking for it. So every id is resolved first,
# and one unresolvable id refuses the whole batch with nothing staged.
SRCS=(); DESTS=(); BASES=(); RELSRCS=(); RELDESTS=()
for ID in "${IDS[@]}"; do
  MATCHES=("$ROOT/backlog/active/$ID"-*.yaml)
  if [[ ! -e "${MATCHES[0]}" ]]; then
    echo "close_ticket: REFUSED - $ID is not in backlog/active/; nothing was moved or staged." >&2
    exit 1
  fi
  if (( ${#MATCHES[@]} != 1 )); then
    echo "close_ticket: REFUSED - $ID matches ${#MATCHES[@]} files in backlog/active/; nothing was moved or staged." >&2
    exit 1
  fi
  SRC="${MATCHES[0]}"
  BASE="$(basename "$SRC")"
  # The milestone is the ticket's own field, which every ticket carries and
  # the hygiene gate already enforces - never guessed, never defaulted.
  MILESTONE="$(sed -n 's/^milestone:[[:space:]]*\([A-Za-z0-9._-]*\).*/\1/p' "$SRC" | head -1)"
  if [[ -z "$MILESTONE" ]]; then
    echo "close_ticket: REFUSED - $ID has no milestone: field, so its done directory cannot be decided; nothing was moved or staged." >&2
    exit 1
  fi
  SRCS+=("$SRC")
  BASES+=("$BASE")
  DESTS+=("$ROOT/backlog/done/$MILESTONE/$BASE")
  RELSRCS+=("backlog/active/$BASE")
  RELDESTS+=("backlog/done/$MILESTONE/$BASE")
done

# ── Snapshot, exactly as promotion does (BL-1028) ──────────────────────────
# Scoped to the paths this script stages itself - never a blanket `git reset`,
# which on the shared master checkout would discard other roles' staged work.
CLOSE_SNAPSHOT_DIR="$(mktemp -d)"
trap 'rm -rf "$CLOSE_SNAPSHOT_DIR"' EXIT
git -C "$ROOT" ls-files --stage -- "${RELSRCS[@]}" "${RELDESTS[@]}" \
  > "$CLOSE_SNAPSHOT_DIR/index" 2>/dev/null || : > "$CLOSE_SNAPSHOT_DIR/index"
for i in "${!SRCS[@]}"; do
  cp "${SRCS[$i]}" "$CLOSE_SNAPSHOT_DIR/src.$i"
done

rollback_close() {
  git -C "$ROOT" update-index --force-remove -- "${RELSRCS[@]}" "${RELDESTS[@]}" 2>/dev/null || true
  if [[ -s "$CLOSE_SNAPSHOT_DIR/index" ]]; then
    git -C "$ROOT" update-index --index-info < "$CLOSE_SNAPSHOT_DIR/index" 2>/dev/null || true
  fi
  for i in "${!SRCS[@]}"; do
    rm -f "${DESTS[$i]}"
    cp "$CLOSE_SNAPSHOT_DIR/src.$i" "${SRCS[$i]}"
  done
}

# Same two refusal shapes promotion reads, and for the same reason: a
# :success-false refusal prints JSON on stdout and `FAILED (reason)` on stderr,
# while a close-guard rejection prints only `CLOSE BLOCKED` and no JSON.
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

for i in "${!SRCS[@]}"; do
  mkdir -p "$(dirname "${DESTS[$i]}")"
  if ! git -C "$ROOT" mv "${RELSRCS[$i]}" "${RELDESTS[$i]}" 2>"$CLOSE_SNAPSHOT_DIR/mv.err"; then
    cat "$CLOSE_SNAPSHOT_DIR/mv.err" >&2
    rollback_close
    echo "close_ticket: REFUSED - could not move ${IDS[$i]}; every ticket in this close was rolled back and none moved." >&2
    exit 1
  fi
done

# Article 2.6: the subject names EVERY id this close satisfies. An id missing
# from the record is an id nobody will look for again.
SUBJECT="Close $(IFS=, ; echo "${IDS[*]}"): move to done"

INTEGRITY_ARGS=()
for rel in "${RELSRCS[@]}" "${RELDESTS[@]}"; do
  INTEGRITY_ARGS+=(--path "$rel")
done

if [[ -f "$SCRIPT_DIR/commit_integrity_cli.bb" ]]; then
  INTEGRITY_RC=0
  bb "$SCRIPT_DIR/commit_integrity_cli.bb" "$ROOT" \
    --message "$SUBJECT" \
    "${INTEGRITY_ARGS[@]}" \
    > "$CLOSE_SNAPSHOT_DIR/integrity.out" \
    2> "$CLOSE_SNAPSHOT_DIR/integrity.err" || INTEGRITY_RC=$?
  cat "$CLOSE_SNAPSHOT_DIR/integrity.out"
  cat "$CLOSE_SNAPSHOT_DIR/integrity.err" >&2
  if (( INTEGRITY_RC != 0 )); then
    REASON="$(integrity_refusal_reason \
      "$CLOSE_SNAPSHOT_DIR/integrity.out" "$CLOSE_SNAPSHOT_DIR/integrity.err")"
    rollback_close
    echo "close_ticket: integrity commit REFUSED (${REASON}) for ${IDS[*]} — rolled the staged active → done rename back; nothing moved. NOT overriding a refusal with a raw commit (BL-1028)." >&2
    exit 1
  fi
else
  # Deliberate degradation for a target that never had the guard - said out
  # loud so an unguarded commit is never mistaken for a guarded one.
  git -C "$ROOT" add -- "${RELDESTS[@]}"
  git -C "$ROOT" add -u -- "${RELSRCS[@]}" 2>/dev/null || true
  git -C "$ROOT" commit -m "$SUBJECT"
  echo "close_ticket: no commit_integrity_cli.bb in this target — committed WITHOUT the integrity guard." >&2
fi

for i in "${!IDS[@]}"; do
  echo "Closed ${IDS[$i]} → ${RELDESTS[$i]}"
done
# Closing never promotes (invariant 3): promote_and_route_next.sh owns the
# follow-on, so a refused close can never strand a promoted ticket on NO_TASK.
