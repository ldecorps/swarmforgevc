#!/usr/bin/env bash
# BL-1145 hardener: surgical mutation over promotion_gates_lib.bb.
#
# Soft Gherkin is BL-638 inapplicable (plain Scenarios). Each mutant is a
# single edit the unit + property runners must reject.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=swarmforge/scripts/promotion_gates_lib.bb
UNIT=swarmforge/scripts/test/promotion_gates_lib_test_runner.bb
PROP=swarmforge/scripts/test/promotion_gates_lib_property_runner.bb
FEATURE=specs/features/BL-1145-open-slot-nudge-skips-epic-trackers.feature
ACCEPT=(bash specs/pipeline/scripts/run_acceptance.sh "$FEATURE")

BACKUP="$(mktemp)"
cp "$LIB" "$BACKUP"
restore() { cp "$BACKUP" "$LIB"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()

suite_fails() {
  if ! bb "$UNIT" >/dev/null 2>&1; then return 0; fi
  if ! PROPERTY_RUNS=200 bb "$PROP" >/dev/null 2>&1; then return 0; fi
  if ! "${ACCEPT[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate() {
  local label="$1" from="$2" to="$3"
  restore
  if ! python3 - "$LIB" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
if a not in s:
    sys.exit(3)
open(p, 'w').write(s.replace(a, b, 1))
PY
  then
    echo "  skip     $label (anchor not found)"
    skipped=$((skipped + 1)); return
  fi
  if suite_fails; then
    echo "  killed   $label"
    killed=$((killed + 1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label")
  survived=$((survived + 1))
}

echo "mutation sweep over $LIB"

mutate "drop epic-type-refusal from evaluate chain" \
  '      (some->> (epic-type-refusal content) (merge {:ok false}))' \
  ''

mutate "drop blocked-status-refusal from evaluate chain" \
  '      (some->> (blocked-status-refusal content) (merge {:ok false}))' \
  ''

mutate "epic-type-refusal never fires" \
  '(when (= "epic" (read-type content))' \
  '(when (= "never" (read-type content))'

mutate "blocked-status-refusal never fires" \
  '(when (= "blocked" (read-status content))' \
  '(when (= "never" (read-status content))'

mutate "epic gate label swapped to feature" \
  '{:gate "epic"' \
  '{:gate "feature"'

mutate "evaluate epic after human_approval (order drift)" \
  '      (some->> (epic-type-refusal content) (merge {:ok false}))
      (some->> (blocked-status-refusal content) (merge {:ok false}))
      (some->> (human-approval-refusal content) (merge {:ok false}))' \
  '      (some->> (human-approval-refusal content) (merge {:ok false}))
      (some->> (epic-type-refusal content) (merge {:ok false}))
      (some->> (blocked-status-refusal content) (merge {:ok false}))'

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
printf 'survivors: %s\n' "${SURVIVORS[*]:-none}"
