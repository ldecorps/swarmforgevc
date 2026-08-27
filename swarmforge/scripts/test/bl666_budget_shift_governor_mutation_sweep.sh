#!/usr/bin/env bash
# BL-666 hardener: surgical mutation over budgetShiftGovernor.ts.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC=extension/src/metrics/budgetShiftGovernor.ts
UNIT=(npx vitest run test/budgetShiftGovernor.test.js)
PROP=(npx vitest run --config vitest.properties.config.mjs test/budgetShiftGovernor.property.test.js)

BACKUP="$(mktemp)"
cp "$SRC" "$BACKUP"
restore() { cp "$BACKUP" "$SRC"; }
cleanup() { restore; rm -f "$BACKUP"; (cd extension && npm run compile >/dev/null 2>&1) || true; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && "${UNIT[@]}" >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && "${PROP[@]}" >/dev/null 2>&1); then return 0; fi
  return 1
}

mutate() {
  local label="$1" from="$2" to="$3"
  restore
  if ! python3 - "$SRC" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
if a not in s:
    sys.exit(3)
open(p, 'w').write(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

echo "mutation sweep over $SRC (BL-666)"

mutate "paid credits guard" "if (input.spendPaidCredits && !input.paidCreditsOptIn)" "if (false)"
mutate "degraded approximate label" "{ degraded: true, trimmedHours, exact: false }" "{ degraded: true, trimmedHours, exact: true }"
mutate "full verdict threshold" "if (ratio <= 1.0)" "if (ratio <= 2.0)"
mutate "SHORT verdict threshold" "if (ratio <= 1.35)" "if (ratio <= 0.5)"
mutate "CHEAP verdict threshold" "if (ratio <= 2.5)" "if (ratio <= 1.0)"
mutate "SKIP when unaffordable" "if (affordable <= 0)" "if (false)"

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]]
