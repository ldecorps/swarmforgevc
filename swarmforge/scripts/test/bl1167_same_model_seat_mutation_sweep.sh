#!/usr/bin/env bash
# BL-1167 hardener: surgical mutation over seat_difficulty_lib.bb same-model bypass.
#
# Soft Gherkin is BL-638 inapplicable (plain Scenarios, no Outline Examples).
# Production files are BL-149 skip-cooldown this pass. Each mutant is a single
# edit the unit + property suites must reject.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=swarmforge/scripts/seat_difficulty_lib.bb
UNIT=(bb swarmforge/scripts/test/seat_difficulty_lib_test_runner.bb)
PROP=(npx vitest run --config vitest.properties.config.mjs test/bl1167SameModelSeatRouting.property.test.js)

BACKUP="$(mktemp)"
cp "$LIB" "$BACKUP"
restore() { cp "$BACKUP" "$LIB"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()

suite_fails() {
  if ! "${UNIT[@]}" >/dev/null 2>&1; then return 0; fi
  if ! (cd extension && "${PROP[@]}" >/dev/null 2>&1); then return 0; fi
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

echo "mutation sweep over $LIB (BL-1167)"

mutate "equivalent bypass claims skip instead" \
  '(stage-models-equivalent? models conf-text stage)
    :claim' \
  '(stage-models-equivalent? models conf-text stage)
    :skip-ineligible'

mutate "equivalent needs three seats" \
  '(pos? (count seats))' \
  '(>= (count seats) 3)'

mutate "equivalent requires single model value" \
  '(= 1 (count values))' \
  '(pos? (count values))'

mutate "equivalent requires every seat has model" \
  '(= (count seats) (count (filter #(contains? models %) seats)))' \
  'false'

mutate "stage-seat filter never matches" \
  '(= stage (seat-stage seat))' \
  '(= stage "nope")'

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
printf 'survivors: %s\n' "${SURVIVORS[*]:-none}"
if (( survived > 0 || skipped > 0 )); then
  exit 1
fi
exit 0
