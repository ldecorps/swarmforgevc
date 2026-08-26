#!/usr/bin/env bash
# BL-755 hardener: surgical mutation over multiBranchParserCoverageCheck.ts.
# Soft Gherkin inapplicable (no Scenario Outline).
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC=extension/src/tools/multiBranchParserCoverageCheck.ts
UNIT=(node --test extension/test/multiBranchParserCoverageCheck.test.js)
PROP=(npx vitest run --config vitest.properties.config.mjs test/multiBranchParserCoverageCheck.property.test.js)

BACKUP="$(mktemp)"
cp "$SRC" "$BACKUP"
restore() { cp "$BACKUP" "$SRC"; }
cleanup() { restore; rm -f "$BACKUP"; (cd extension && npm run compile >/dev/null 2>&1) || true; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! "${UNIT[@]}" >/dev/null 2>&1; then return 0; fi
  if ! (cd extension && "${PROP[@]}" >/dev/null 2>&1); then return 0; fi
  return 1
}

mutate() {
  local label="$1"
  restore
  if ! python3 - "$SRC" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
s = p.read_text()
a = Path('/tmp/bl755_from.txt').read_text()
b = Path('/tmp/bl755_to.txt').read_text()
if a not in s:
    sys.exit(3)
p.write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  python3 -c "open('/tmp/bl755_from.txt','w').write($1); open('/tmp/bl755_to.txt','w').write($2)"
}

echo "mutation sweep over $SRC (BL-755)"

write_pair \
  "r'''if (input.parsers === undefined || input.testTexts === undefined) {
    return { checked: false };
  }'''" \
  "r'''if (input.parsers === undefined || input.testTexts === undefined) {
    return { checked: true, parsersScanned: 0 };
  }'''"
mutate "fail-open undefined -> vacuous checked:true"

write_pair \
  "r'if (input.parsers === undefined || input.testTexts === undefined)'" \
  "r'if (input.parsers === undefined && input.testTexts === undefined)'"
mutate "fail-open OR -> AND"

write_pair \
  "r'if (!armExercisedByTests(arm, input.testTexts))'" \
  "r'if (armExercisedByTests(arm, input.testTexts))'"
mutate "miss polarity inverted"

write_pair \
  "r'export const MIN_PARSER_ARMS = 3;'" \
  "r'export const MIN_PARSER_ARMS = 4;'"
mutate "MIN_PARSER_ARMS 3 -> 4"

write_pair \
  "r'const parsers = input.parsers.filter((p) => p.arms.length >= MIN_PARSER_ARMS);'" \
  "r'const parsers = input.parsers.filter((p) => p.arms.length > MIN_PARSER_ARMS);'"
mutate "assess filter >= becomes >"

write_pair \
  "r'if (parsers.length === 0)'" \
  "r'if (parsers.length !== 0)'"
mutate "empty parsers no-op inverted"

write_pair \
  "r'return testTexts.some((text) => text.includes(arm.marker));'" \
  "r'return true;'"
mutate "armExercised always true"

write_pair \
  "r'return testTexts.some((text) => text.includes(arm.marker));'" \
  "r'return false;'"
mutate "armExercised always false"

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]]
