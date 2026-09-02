#!/usr/bin/env bash
# BL-1334 END TO END: the REAL land_step_cli.bb, over a REAL fixture repo,
# writes the replay->approved-source record, and the REAL is_qa_ancestor.sh
# then answers approved for the commit it just built - with NO merge into
# swarmforge-QA afterwards.
#
# This exists because the lib test proves the record can be written and the
# predicate test proves a record can be read. Neither proves the land step
# actually calls the writer. A recorder that is never called reads exactly
# like a working one from either side, and that is the fault class this
# ticket is about: a gate everyone assumes fired.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../land_step_cli.bb"
PREDICATE="$SCRIPT_DIR/../is_qa_ancestor.sh"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
g() { git -C "$ROOT" -c user.email=t@t -c user.name=t "$@"; }

g init -q -b main
mkdir -p "$ROOT/extension/src" "$ROOT/backlog/active"
printf 'seed\n' > "$ROOT/extension/src/seed.ts"
g add -A; g commit -q -m seed

# origin/main must resolve: the replay builds on top of it.
g remote add origin "$ROOT"
g update-ref refs/remotes/origin/main HEAD

# An ENTANGLED SIBLING first: BL-9002's work is in the tip's history but is
# NOT on origin/main. That entanglement is what makes the land step build a
# tip-pure replay instead of landing the cited commit as-is - which is the
# only path that mints a new commit, and so the only path this ticket is
# about.
printf 'export const sib = 1;\n' > "$ROOT/extension/src/sibling.ts"
printf 'id: BL-9002\ntitle: "sibling fixture"\n' > "$ROOT/backlog/active/BL-9002-fixture.yaml"
g add -A; g commit -q -m "BL-9002: an unlanded sibling's work"

# The parcel QA approved, on top of the sibling.
printf 'export const a = 1;\n' > "$ROOT/extension/src/a.ts"
printf 'id: BL-9001\ntitle: "fixture"\n' > "$ROOT/backlog/active/BL-9001-fixture.yaml"
g add -A; g commit -q -m "BL-9001: the approved parcel work"
SOURCE_SHA="$(g rev-parse HEAD)"

# QA reviewed it: the QA ref names the approved source.
g branch swarmforge-QA
# main moves on WITHOUT the parcel, so the land step has a real replay to do.
g checkout -q main

run_cli() {
  set +e
  OUT="$(cd "$ROOT" && bb "$CLI" "BL-9001" "$SOURCE_SHA" "$ROOT" 2>&1)"
  CLI_EXIT=$?
  set -e
}
run_cli

STORE_DIR="$ROOT/.swarmforge/land-approvals"
check "the land step exits cleanly" '[[ $CLI_EXIT -eq 0 ]]'

# LAND_CLEAN means no replay was needed - then there is no new commit and
# nothing to record, which is correct and not what this fixture exercises.
if [[ "$OUT" == *"LAND_REPLAY"* ]]; then
  REPLAY_SHA="$(printf '%s' "$OUT" | awk '/^LAND_REPLAY /{print $3}')"
  check "the land step records the replay->source mapping (the writer is WIRED)" \
    '[[ -d "$STORE_DIR" ]] && [[ -n "$(ls -A "$STORE_DIR" 2>/dev/null)" ]]'
  RECORD="$(cat "$STORE_DIR"/*.jsonl 2>/dev/null || true)"
  check "the record names the replay commit the CLI announced" \
    '[[ "$RECORD" == *"\"commit\":\"${REPLAY_SHA:0:10}\""* ]]'
  check "the record names the approved source that was cited" \
    '[[ "$RECORD" == *"\"source\":\"${SOURCE_SHA:0:10}\""* ]]'
  check "the record names the ticket" '[[ "$RECORD" == *"\"ticket\":\"BL-9001\""* ]]'

  # The defect proper: the replay is NOT an ancestor of swarmforge-QA, and no
  # merge into that ref has happened. Before this ticket that meant "not
  # approved"; the record is what makes it answer approved.
  set +e
  (cd "$ROOT" && git merge-base --is-ancestor "$REPLAY_SHA" swarmforge-QA)
  ANCESTRY=$?
  set -e
  check "the replay is genuinely NOT an ancestor of the QA ref (the fixture is honest)" \
    '[[ $ANCESTRY -ne 0 ]]'

  set +e
  PRED_OUT="$(cd "$ROOT" && bash "$PREDICATE" "$REPLAY_SHA" 2>&1)"
  PRED_EXIT=$?
  set -e
  check "the shared predicate answers approved for the freshly landed replay" \
    '[[ $PRED_EXIT -eq 0 ]]'
  check "and says why, naming the source it resolved" \
    '[[ "$PRED_OUT" == *"land-step replay of approved source"* ]]'

  # Approval never spreads: an unrelated commit on the same branch gains none.
  printf 'export const b = 2;\n' > "$ROOT/extension/src/b.ts"
  g add -A; g commit -q -m "unrelated pipeline code, no approved parcel"
  UNRELATED="$(g rev-parse HEAD)"
  set +e
  (cd "$ROOT" && bash "$PREDICATE" "$UNRELATED" >/dev/null 2>&1)
  UNREL_EXIT=$?
  set -e
  check "an unrelated commit on the same branch is still NOT approved" \
    '[[ $UNREL_EXIT -eq 1 ]]'
else
  note "FAIL - fixture did not produce a replay (got: $(printf '%s' "$OUT" | head -1))"
  fail=1
fi

if [[ $fail -eq 0 ]]; then
  echo "land step records approval: ALL CHECKS PASSED"
else
  echo "land step records approval: FAILURES"
  exit 1
fi
