#!/usr/bin/env bash
# BL-758 hardener: surgical mutation over perHatRolePromptEvidenceCheck.ts.
# Soft Gherkin inapplicable (no Scenario Outline).
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC=extension/src/tools/perHatRolePromptEvidenceCheck.ts
UNIT=(node --test extension/test/perHatRolePromptEvidenceCheck.test.js)
PROP=(npx vitest run --config vitest.properties.config.mjs test/perHatRolePromptEvidenceCheck.property.test.js)

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
a = Path('/tmp/bl758_from.txt').read_text()
b = Path('/tmp/bl758_to.txt').read_text()
if a not in s:
    sys.exit(3)
p.write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  python3 -c "open('/tmp/bl758_from.txt','w').write($1); open('/tmp/bl758_to.txt','w').write($2)"
}

echo "mutation sweep over $SRC (BL-758)"

write_pair \
  "r'''if (input.verdicts === undefined) {
    return { checked: false };
  }'''" \
  "r'''if (input.verdicts === undefined) {
    return { checked: true, verdictsScanned: 0 };
  }'''"
mutate "fail-open undefined -> vacuous checked:true"

write_pair \
  "r'if (input.verdicts.length === 0)'" \
  "r'if (input.verdicts.length !== 0)'"
mutate "empty verdicts no-op inverted"

write_pair \
  "r'if (!verdictHasRolePromptEvidence(verdict))'" \
  "r'if (verdictHasRolePromptEvidence(verdict))'"
mutate "miss polarity inverted"

write_pair \
  "r'return pathOk && hashOk;'" \
  "r'return pathOk || hashOk;'"
mutate "path AND hash -> OR"

write_pair \
  "r\"/^[a-f0-9]{64}$/i\"" \
  "r\"/^[a-f0-9]{32}$/i\""
mutate "hash length 64 -> 32"

write_pair \
  "r'verdict.role_prompt_path.trim().length > 0'" \
  "r'verdict.role_prompt_path.trim().length >= 0'"
mutate "path length >0 -> >=0"

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]]
