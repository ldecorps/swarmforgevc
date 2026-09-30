#!/usr/bin/env bash
# BL-1846 hardener pass: two pure/near-pure helpers introduced for the
# deterministic-coordinator promotion path are exercised end to end by the
# acceptance feature only along ONE branch each (a single paused ticket,
# always the same candidate id across every tick) - a mutant on the branch
# the acceptance never takes would survive silently. This drives both
# helpers directly (BL-1395's own guarded load-file idiom, so loading
# handoffd.bb never starts the daemon loop).
#
# 1. handoffd/deterministic-last-refusal-reason: guards against reading a
#    STALE refusal reason for a DIFFERENT candidate than the one the atom
#    was last set for (top-open-slot-candidate can change between ticks).
#    The acceptance feature's own scenario 03 uses one candidate across all
#    3 ticks, so the id-mismatch branch is never taken there.
# 2. handoffd/paused-ticket-still-present?: the ground-truth check
#    deterministic-promote-and-route! uses instead of trusting
#    promote_and_route_next.sh's own exit code (the coder's evidence names
#    this as the fix for a real mailbox-only-mode gap) - exercised here
#    directly against a real backlog/paused/ directory, both present and
#    absent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

mkdir -p "$ROOT/backlog/paused"
cat > "$ROOT/backlog/paused/BL-1-fixture.yaml" <<'EOF'
id: BL-1
title: "fixture"
type: feature
EOF

OUT="$(SWARMFORGE_ALLOW_TMP_DAEMON=1 bb -e "
(binding [*command-line-args* [\"$ROOT\"]]
  (load-file \"$HANDOFFD\"))
(reset! handoffd/open-slot-deterministic-last-refusal {:id \"BL-1\" :reason \"no eligible paused ticket\"})
(println (handoffd/deterministic-last-refusal-reason \"BL-1\"))
(println (handoffd/deterministic-last-refusal-reason \"BL-2\"))
(reset! handoffd/open-slot-deterministic-last-refusal nil)
(println (handoffd/deterministic-last-refusal-reason \"BL-1\"))
(println (handoffd/paused-ticket-still-present? \"BL-1\"))
(println (handoffd/paused-ticket-still-present? \"BL-999-not-there\"))
" 2>&1)"
RC=$?

[[ "$RC" -eq 0 ]] || fail "probe exited $RC: $OUT"

MATCHING_ID_LINE="$(sed -n '1p' <<<"$OUT")"
MISMATCHED_ID_LINE="$(sed -n '2p' <<<"$OUT")"
NIL_ATOM_LINE="$(sed -n '3p' <<<"$OUT")"
PRESENT_LINE="$(sed -n '4p' <<<"$OUT")"
ABSENT_LINE="$(sed -n '5p' <<<"$OUT")"

[[ "$MATCHING_ID_LINE" == "no eligible paused ticket" ]] || fail "matching id must read the stored reason verbatim: $MATCHING_ID_LINE"
pass "deterministic-last-refusal-reason reads the stored reason for the matching candidate id"

[[ "$MISMATCHED_ID_LINE" == "unknown" ]] || fail "a DIFFERENT candidate id must never read the prior candidate's stale reason: $MISMATCHED_ID_LINE"
pass "deterministic-last-refusal-reason falls back to unknown for a non-matching candidate id (never a stale reason)"

[[ "$NIL_ATOM_LINE" == "unknown" ]] || fail "a nil atom (no refusal recorded) must read unknown: $NIL_ATOM_LINE"
pass "deterministic-last-refusal-reason falls back to unknown when nothing has been refused yet"

[[ "$PRESENT_LINE" == "true" ]] || fail "a ticket file still in backlog/paused/ must read present: $PRESENT_LINE"
pass "paused-ticket-still-present? reads true for a ticket whose file is still in backlog/paused/"

[[ "$ABSENT_LINE" == "false" ]] || fail "an id with no matching paused yaml must read absent: $ABSENT_LINE"
pass "paused-ticket-still-present? reads false for an id with no matching backlog/paused/ file"

echo "ALL PASS"
