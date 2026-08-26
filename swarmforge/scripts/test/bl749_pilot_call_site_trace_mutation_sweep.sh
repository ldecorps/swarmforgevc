#!/usr/bin/env bash
# BL-749 hardener: surgical mutation over composePilotExpeditorPrompt REVIEW HATS
# guidance (call-site before nit-downgrade). Soft Gherkin inapplicable (no Outline).
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC=extension/src/tools/telegramCursorBridgePilot.ts
UNIT=(node --test --test-name-pattern='BL-749' extension/test/telegramCursorBridgePilot.test.js)
APS=(bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-749-pilot-guardrail-gap-requires-call-site-trace.feature)

BACKUP="$(mktemp)"
cp "$SRC" "$BACKUP"
restore() { cp "$BACKUP" "$SRC"; }
cleanup() { restore; rm -f "$BACKUP"; (cd extension && npm run compile >/dev/null 2>&1) || true; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! "${UNIT[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${APS[@]}" >/dev/null 2>&1; then return 0; fi
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
a = Path('/tmp/bl749_from.txt').read_text()
b = Path('/tmp/bl749_to.txt').read_text()
if a not in s:
    sys.exit(3)
p.write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  python3 -c "open('/tmp/bl749_from.txt','w').write($1); open('/tmp/bl749_to.txt','w').write($2)"
}

echo "mutation sweep over $SRC (BL-749)"

write_pair \
  "r\"REVIEW HATS (cleaner / hardener / architect during /pilot) — BL-749:\"" \
  "r\"REVIEW NOTE (cleaner / hardener / architect during /pilot) — BL-749:\""
mutate "REVIEW HATS header -> NOTE"

write_pair \
  "r\"A gap against the ticket\\'s OWN explicit guardrail claim is never a\"" \
  "r\"A gap against the ticket\\'s OWN explicit guardrail claim is always a\""
mutate "never -> always non-blocking nit"

write_pair \
  "r\"Call-site tracing before nit-downgrade is mandatory.\"" \
  "r\"Call-site tracing before nit-downgrade is optional.\""
mutate "mandatory -> optional"

write_pair \
  "r\"CALL SITE (not only the\"" \
  "r\"FUNCTION BODY (not only the\""
mutate "CALL SITE -> FUNCTION BODY"

write_pair \
  "r\"function in isolation) and confirmed\"" \
  "r\"module export) and confirmed\""
mutate "function in isolation -> module export"

write_pair \
  "r\"OWN explicit guardrail claim\"" \
  "r\"OWN soft preference note\""
mutate "guardrail claim -> soft preference"

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]]
