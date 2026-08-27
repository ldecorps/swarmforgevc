#!/usr/bin/env bash
# BL-658 hardener: surgical mutation over nightClosingCeremony.ts (pure core).
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC=extension/src/quality/nightClosingCeremony.ts
UNIT=(node --test extension/test/nightClosingCeremony.test.js)
PROP=(npx vitest run --config vitest.properties.config.mjs test/nightClosingCeremony.property.test.js)

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
a = Path('/tmp/bl658_from.txt').read_text()
b = Path('/tmp/bl658_to.txt').read_text()
if a not in s:
    sys.exit(3)
p.write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  python3 -c "open('/tmp/bl658_from.txt','w').write($1); open('/tmp/bl658_to.txt','w').write($2)"
}

echo "mutation sweep over $SRC (BL-658)"

write_pair \
  "r\"return schedule.state !== 'ok';\"" \
  "r\"return schedule.state === 'ok';\""
mutate "shouldConsultFixedMorning polarity"

write_pair \
  "r\"return schedule.state === 'absent' || schedule.state === 'ambiguous';\"" \
  "r'return false;'"
mutate "fixedMorningTriggerFires always false"

write_pair \
  "r'const begin = minutesOfDay(closure) - budgets.drainBudgetMinutes - budgets.briefingBudgetMinutes;'" \
  "r'const begin = minutesOfDay(closure) - budgets.drainBudgetMinutes;'"
mutate "begin omits briefing budget"

write_pair \
  "r'const rotationRequested = !endedAtDocumenter;'" \
  "r'const rotationRequested = endedAtDocumenter;'"
mutate "rotation polarity inverted"

python3 - <<'INNER'
from pathlib import Path
p = Path("extension/src/quality/nightClosingCeremony.ts")
s = p.read_text()
a = """  if (fixture.briefingAlreadySent) {
    push(sequence, 'briefing-already-sent');
    push(sequence, 'swarm-stopped');
    return resultBase({
      sequence,
      rotationRequested: false,
      deliveriesAfterFreeze,
      sendConfirmations: 1,
      sendSource: 'sent-state',
"""
b = a.replace("sendSource: 'sent-state',", "sendSource: 'file-exists',")
open('/tmp/bl658_from.txt','w').write(a)
open('/tmp/bl658_to.txt','w').write(b)
INNER
mutate "already-sent sendSource -> file-exists"

write_pair \
  "r'if (fixture.briefingAlreadySent)'" \
  "r'if (!fixture.briefingAlreadySent)'"
mutate "already-sent branch inverted"

write_pair \
  "r\"endedAtDocumenter: inFlight.role === 'documenter',\"" \
  "r\"endedAtDocumenter: inFlight.role !== 'documenter',\""
mutate "documenter drain polarity"

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]]
