#!/usr/bin/env bash
# BL-1334 scenario 03: the deploy gate stops refusing a freshly landed replay.
#
# build_freshness_cli.bb used to decide approval on its own - merge-base main
# swarmforge-QA, then every commit since - so a land-step replay (necessarily
# after that base, necessarily touching the deployed surface) was ALWAYS
# offending drift. The coordinator had to run `sync --override` to keep
# working, twice on 2026-09-02. The gate now asks the ONE approval predicate.
#
# This file exists separately from test_build_freshness_cli.sh because that
# suite has a pre-existing failure early on (a process-staleness assertion,
# unrelated to approval) and `set -e` aborts it before any approval assertion
# runs - so it cannot cover this wiring either way.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../build_freshness_cli.bb"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
g() { git -C "$ROOT" -c user.email=t@t -c user.name=t "$@"; }

g init -q -b main
mkdir -p "$ROOT/extension/src" "$ROOT/swarmforge/scripts"
# The predicate must be the REAL one - this test proves the CLI consults it.
cp "$SCRIPT_DIR/../is_qa_ancestor.sh" "$ROOT/swarmforge/scripts/is_qa_ancestor.sh"
chmod +x "$ROOT/swarmforge/scripts/is_qa_ancestor.sh"
printf 'seed\n' > "$ROOT/extension/src/seed.ts"
g add -A; g commit -q -m seed
g branch swarmforge-QA          # the QA ref is pinned HERE and never moves

# A land-step replay: on main, after the merge-base, touching the deployed
# surface. Exactly the shape that was always refused.
printf 'export const landed = 1;\n' > "$ROOT/extension/src/landed.ts"
g add -A; g commit -q -m "BL-9001: tip-pure replay onto origin/main"
REPLAY_SHA="$(g rev-parse HEAD)"
SOURCE_SHA="$(g rev-parse swarmforge-QA)"

report() {
  set +e
  OUT="$(cd "$ROOT" && bb "$CLI" "$ROOT" report 2>&1)"
  set -e
}

# ── before the record: the defect, confirmed present ──────────────────────
report
check "without a land record the replay is offending drift (the defect)" \
  '[[ "$OUT" == *"\"approved\":false"* ]] && [[ "$OUT" == *"${REPLAY_SHA}"* ]]'

# ── the land step's record, mapping the replay to its approved source ─────
mkdir -p "$ROOT/.swarmforge/land-approvals"
printf '{"at":"2026-09-02T00:00:00Z","ticket":"BL-9001","commit":"%s","source":"%s"}\n' \
  "${REPLAY_SHA:0:10}" "${SOURCE_SHA:0:10}" > "$ROOT/.swarmforge/land-approvals/2026-09.jsonl"

report
check "with the record the gate reports the branch as QA-approved" \
  '[[ "$OUT" == *"\"approved\":true"* ]]'
check "and names no offending commit" \
  '[[ "$OUT" == *"\"offending_shas\":[]"* ]]'
check "still with NO merge into the QA ref" \
  '[[ "$(g rev-parse swarmforge-QA)" == "$SOURCE_SHA" ]]'

# ── approval never spreads: an unrelated surface commit still refuses ─────
printf 'export const other = 2;\n' > "$ROOT/extension/src/other.ts"
g add -A; g commit -q -m "unrelated pipeline code belonging to no approved parcel"
UNRELATED="$(g rev-parse HEAD)"
report
check "an unrelated surface commit still makes the gate refuse" \
  '[[ "$OUT" == *"\"approved\":false"* ]] && [[ "$OUT" == *"${UNRELATED}"* ]]'
check "and the approved replay is NOT named among the offenders" \
  '[[ "$(printf "%s" "$OUT" | grep -o "${REPLAY_SHA}" | head -1)" == "" ]]'

# ── a bounce on the source flips it back (BL-952 veto survives the gate) ──
mkdir -p "$ROOT/.swarmforge/bounces"
printf '{"at":"2026-09-02T00:05:00Z","by":"QA","commit":"%s","evidence":"x"}\n' "${SOURCE_SHA:0:10}" \
  > "$ROOT/.swarmforge/bounces/2026-09.jsonl"
report
check "a bounce verdict on the source makes the replay offending again" \
  '[[ "$OUT" == *"${REPLAY_SHA}"* ]]'

# ── report performs no compile and no daemon restart (qa_e2e last clause) ──
check "report writes no build artefacts" '[[ ! -d "$ROOT/extension/out" ]]'

if [[ $fail -eq 0 ]]; then
  echo "build freshness land-replay approval: ALL CHECKS PASSED"
else
  echo "build freshness land-replay approval: FAILURES"
  exit 1
fi
