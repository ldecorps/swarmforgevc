#!/usr/bin/env bash
# BL-753 hardener: surgical mutation over unreachableStepHandlerCheck.ts.
# Soft Gherkin inapplicable (no Scenario Outline).
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC=extension/src/tools/unreachableStepHandlerCheck.ts
UNIT=(node --test extension/test/unreachableStepHandlerCheck.test.js)
PROP=(npx vitest run --config vitest.properties.config.mjs test/unreachableStepHandlerCheck.property.test.js)

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
a = Path('/tmp/bl753_from.txt').read_text()
b = Path('/tmp/bl753_to.txt').read_text()
if a not in s:
    sys.exit(3)
p.write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  python3 -c "open('/tmp/bl753_from.txt','w').write($1); open('/tmp/bl753_to.txt','w').write($2)"
}

echo "mutation sweep over $SRC (BL-753)"

write_pair \
  "r'''if (input.feature === undefined || input.stepFiles === undefined) {
    return { checked: false };
  }'''" \
  "r'''if (input.feature === undefined || input.stepFiles === undefined) {
    return { checked: true, stepFilesScanned: 0, patternsChecked: 0 };
  }'''"
mutate "fail-open undefined -> vacuous checked:true"

write_pair \
  "r'if (input.feature === undefined || input.stepFiles === undefined)'" \
  "r'if (input.feature === undefined && input.stepFiles === undefined)'"
mutate "fail-open OR -> AND"

write_pair \
  "r'if (!patternMatchesAnyStep(pattern, rendered))'" \
  "r'if (patternMatchesAnyStep(pattern, rendered))'"
mutate "miss polarity inverted"

write_pair \
  "r'return true; // unparsable literal: fail open for that pattern'" \
  "r'return false; // mutated: refuse unparsable'"
mutate "unparsable fail-open -> refuse"

write_pair \
  "r'return featureConst !== null && featureConst[1] === featureName;'" \
  "r'return featureConst !== null || featureConst[1] === featureName;'"
mutate "FEATURE pair AND -> OR"

write_pair \
  "r'if (stepFiles.length === 0)'" \
  "r'if (stepFiles.length !== 0)'"
mutate "empty stepFiles no-op inverted"

write_pair \
  "r\"  return STEP_HANDLER_PATH_RE.test(relativePath.replace(/\\\\/g, '/'));\"" \
  "r\"  return false;\""
mutate "isStepHandlerPath always false"

write_pair \
  "r\"  return STEP_HANDLER_PATH_RE.test(relativePath.replace(/\\\\/g, '/'));\"" \
  "r\"  return true;\""
mutate "isStepHandlerPath always true"

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]]
