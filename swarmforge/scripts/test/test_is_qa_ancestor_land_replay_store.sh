#!/usr/bin/env bash
# BL-1334: the land step's tip-pure replay mints a NEW commit and publishes it
# to main, but nothing in land_step_lib.bb / land_step_cli.bb /
# land_main_publish.sh advances swarmforge-QA. So QA's own approved work is
# not in the QA ref's ancestry at the instant it lands, and every
# ancestry-based consumer reads main as carrying unapproved pipeline code
# until some later, unrelated merge happens to close the window.
#
# Human ruling: the land step RECORDS the replay-to-approved-source mapping
# and the predicate consults it. This is the same shape BL-1025's expedite
# store already established - a durable record read AFTER the bounce vetoes -
# so it stays ONE predicate with one more approval path, never a second
# definition of approval (BL-925 invariant 2).
#
# The rows that matter most, and why this file exists rather than a looser
# assertion:
#   - approval must NOT spread: a record naming an UNAPPROVED source grants
#     nothing, or the store becomes a rubber stamp for anything written into it;
#   - a bounce verdict still vetoes, whatever the store says (BL-952);
#   - a store that exists and cannot be consulted fails CLOSED (BL-925
#     invariant 3).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREDICATE="$SCRIPT_DIR/../is_qa_ancestor.sh"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
g() { git -C "$ROOT" -c user.email=t@t -c user.name=t "$@"; }

g init -q -b main
g commit -q --allow-empty -m seed
mkdir -p "$ROOT/specs/pipeline/steps"
mk_commit() { # <file> <subject> -> echoes the sha
  printf '%s\n' "$2" > "$ROOT/specs/pipeline/steps/$1"
  g add -A
  g commit -q -m "$2"
  g rev-parse HEAD
}

# The APPROVED SOURCE: QA's own reviewed commit, and the QA ref is pinned to
# it. This is the parcel QA approved.
APPROVED_SOURCE="$(mk_commit src.js 'QA-approved parcel work')"
# A source that IS reachable from swarmforge-QA (so it would read approved by
# ancestry alone) but was ALSO bounced - recorded ONLY in a tracked ticket's
# bounce_history, with NO JSONL entry anywhere. source_is_approved()'s
# YAML_TOKENS check is the only thing that can catch this; the JSONL-only
# mutant this file otherwise exercises (row 3 below) would not.
YAML_BOUNCED_SOURCE="$(mk_commit yaml-bounced.js 'parcel QA bounced via ticket YAML only')"
g branch swarmforge-QA
# A source QA bounced - reachable from nothing, approved by nothing.
BOUNCED_SOURCE="$(mk_commit bounced.js 'parcel QA sent back')"

# Everything below is on main AFTER the QA ref, exactly like a fresh land.
REPLAY_SHA="$(mk_commit replay.js 'BL-1: tip-pure replay onto origin/main')"
REPLAY_OF_BOUNCED="$(mk_commit replay2.js 'BL-2: tip-pure replay onto origin/main')"
UNRELATED_SHA="$(mk_commit unrelated.js 'pipeline code belonging to no approved parcel')"
REPLAY_OF_UNAPPROVED="$(mk_commit replay3.js 'BL-3: tip-pure replay onto origin/main')"
REPLAY_OF_YAML_BOUNCED="$(mk_commit replay4.js 'BL-4: tip-pure replay onto origin/main')"

STORE_DIR="$ROOT/.swarmforge/land-approvals"
mkdir -p "$STORE_DIR"
{
  printf '{"at":"2026-09-02T00:00:00Z","ticket":"BL-1","commit":"%s","source":"%s"}\n' "${REPLAY_SHA:0:10}" "${APPROVED_SOURCE:0:10}"
  printf '{"at":"2026-09-02T00:01:00Z","ticket":"BL-2","commit":"%s","source":"%s"}\n' "${REPLAY_OF_BOUNCED:0:10}" "${BOUNCED_SOURCE:0:10}"
  printf '{"at":"2026-09-02T00:02:00Z","ticket":"BL-3","commit":"%s","source":"%s"}\n' "${REPLAY_OF_UNAPPROVED:0:10}" "${UNRELATED_SHA:0:10}"
  printf '{"at":"2026-09-02T00:05:00Z","ticket":"BL-4","commit":"%s","source":"%s"}\n' "${REPLAY_OF_YAML_BOUNCED:0:10}" "${YAML_BOUNCED_SOURCE:0:10}"
} > "$STORE_DIR/2026-09.jsonl"

# A bounce on file for BOUNCED_SOURCE, in the JSONL store QA actually writes.
mkdir -p "$ROOT/.swarmforge/bounces"
printf '{"at":"2026-09-02T00:03:00Z","by":"QA","commit":"%s","evidence":"x"}\n' "${BOUNCED_SOURCE:0:10}" \
  > "$ROOT/.swarmforge/bounces/2026-09.jsonl"

# A bounce on YAML_BOUNCED_SOURCE, recorded ONLY in a tracked ticket's
# bounce_history - no JSONL entry for it anywhere in this fixture.
mkdir -p "$ROOT/backlog/active"
cat > "$ROOT/backlog/active/BL-9-fixture-ticket.yaml" <<EOF
id: BL-9
title: "fixture ticket for test_is_qa_ancestor_land_replay_store.sh"
status: todo
bounce_count: 1
bounce_history:
  - { at: 2026-09-02, by: QA, blamed: coder, class: unit, commit: ${YAML_BOUNCED_SOURCE:0:10}, evidence: backlog/evidence/BL-9-fixture.md }
EOF
g add -A
g commit -q -m "BL-9 bounce_history"

run_predicate() { # <sha> -> sets OUT and EXIT_CODE
  set +e
  OUT="$(cd "$ROOT" && bash "$PREDICATE" "$1" 2>&1)"
  EXIT_CODE=$?
  set -e
}

# ── row 1: the landed replay of an approved parcel, with NO later merge ────
#    into the QA ref. This is the whole defect: it is not an ancestor of
#    swarmforge-QA and never becomes one by itself.
run_predicate "$REPLAY_SHA"
check "a landed replay of an approved source is approved with no later merge" \
  '[[ $EXIT_CODE -eq 0 ]]'
check "the approval names the land-replay store so a reader can audit it" \
  '[[ "$OUT" == *"land-approvals"* ]] || [[ "$OUT" == *"land replay"* ]]'

# ── row 2: approval NEVER spreads. A pipeline commit belonging to no ───────
#    approved parcel sits on the same branch and gains nothing.
run_predicate "$UNRELATED_SHA"
check "a pipeline commit belonging to no approved parcel is NOT approved" \
  '[[ $EXIT_CODE -eq 1 ]]'

# ── row 3: BL-952's veto still wins. A replay whose SOURCE was bounced is ──
#    not approved, however cleanly the mapping is recorded.
run_predicate "$REPLAY_OF_BOUNCED"
check "a replay whose source carries a bounce verdict is NOT approved" \
  '[[ $EXIT_CODE -eq 1 ]]'

# ── row 3b: BL-952's veto wins even when the SOURCE's only bounce record ──
#    lives in a ticket's bounce_history (YAML store), not the JSONL store -
#    source_is_approved()'s two veto checks are independent guards and each
#    needs its own fixture (a JSONL-only bounce, row 3 above, cannot exercise
#    this branch at all).
run_predicate "$REPLAY_OF_YAML_BOUNCED"
check "a replay whose source carries a YAML-only bounce verdict is NOT approved" \
  '[[ $EXIT_CODE -eq 1 ]]'

# ── row 4: the store is a MAPPING, not a rubber stamp. A record naming a ───
#    source that is itself unapproved grants nothing - otherwise anything
#    written into the store becomes approved by being written.
run_predicate "$REPLAY_OF_UNAPPROVED"
check "a record naming an unapproved source grants no approval" \
  '[[ $EXIT_CODE -eq 1 ]]'

# ── row 5: the source itself is unchanged - still approved by ancestry ─────
run_predicate "$APPROVED_SOURCE"
check "the approved source is still approved by ancestry (predicate unchanged)" \
  '[[ $EXIT_CODE -eq 0 ]]'

# ── row 6: a bounce on the REPLAY itself vetoes, even with a clean mapping ─
printf '{"at":"2026-09-02T00:04:00Z","by":"QA","commit":"%s","evidence":"x"}\n' "${REPLAY_SHA:0:10}" \
  >> "$ROOT/.swarmforge/bounces/2026-09.jsonl"
run_predicate "$REPLAY_SHA"
check "a bounce on the replay itself still vetoes its recorded approval" \
  '[[ $EXIT_CODE -eq 1 ]]'
# restore the clean store for the remaining rows
printf '{"at":"2026-09-02T00:03:00Z","by":"QA","commit":"%s","evidence":"x"}\n' "${BOUNCED_SOURCE:0:10}" \
  > "$ROOT/.swarmforge/bounces/2026-09.jsonl"

# ── row 7: fail CLOSED on an unreadable store (BL-925 invariant 3) ─────────
chmod 000 "$STORE_DIR/2026-09.jsonl" 2>/dev/null || true
if [[ -r "$STORE_DIR/2026-09.jsonl" ]]; then
  note "skip - unreadable-store row (running as root: chmod 000 is still readable)"
else
  run_predicate "$REPLAY_SHA"
  check "an unreadable land-replay store is undeterminable, never approved" \
    '[[ $EXIT_CODE -eq 2 ]]'
fi
chmod 644 "$STORE_DIR/2026-09.jsonl" 2>/dev/null || true

# ── row 8: fail CLOSED on a corrupt record line ───────────────────────────
printf 'this is not a record\n' >> "$STORE_DIR/2026-09.jsonl"
run_predicate "$REPLAY_SHA"
check "a corrupt land-replay record line is undeterminable, never approved" \
  '[[ $EXIT_CODE -eq 2 ]]'
printf '{"at":"2026-09-02T00:00:00Z","ticket":"BL-1","commit":"%s","source":"%s"}\n' "${REPLAY_SHA:0:10}" "${APPROVED_SOURCE:0:10}" \
  > "$STORE_DIR/2026-09.jsonl"

# ── row 9: an ABSENT store is not an error - no land ever recorded ────────
rm -rf "$STORE_DIR"
run_predicate "$UNRELATED_SHA"
check "an absent land-replay store reads as 'no land recorded', never an error" \
  '[[ $EXIT_CODE -eq 1 ]]'

if [[ $fail -eq 0 ]]; then
  echo "is_qa_ancestor land-replay store: ALL CHECKS PASSED"
else
  echo "is_qa_ancestor land-replay store: FAILURES"
  exit 1
fi
