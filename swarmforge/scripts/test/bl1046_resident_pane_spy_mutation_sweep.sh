#!/usr/bin/env bash
# BL-1046 hardener: surgical mutation over residentPaneSpy.ts held-ticket meta.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC=extension/src/concierge/residentPaneSpy.ts
UNIT=(npx vitest run test/residentPaneSpy.test.js)
APS=(bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1046-the-console-tile-names-the-ticket-a-seat-holds.feature)

BACKUP="$(mktemp)"
cp "$SRC" "$BACKUP"
restore() { cp "$BACKUP" "$SRC"; }
cleanup() { restore; rm -f "$BACKUP"; (cd extension && npm run compile >/dev/null 2>&1) || true; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && "${UNIT[@]}" >/dev/null 2>&1); then return 0; fi
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
a = Path('/tmp/bl1046_from.txt').read_text()
b = Path('/tmp/bl1046_to.txt').read_text()
if a not in s:
    sys.exit(3)
p.write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  python3 -c "open('/tmp/bl1046_from.txt','w').write($1); open('/tmp/bl1046_to.txt','w').write($2)"
}

echo "mutation sweep over $SRC (BL-1046)"

write_pair \
  "r'  if (elapsedSec < 60) {'" \
  "r'  if (elapsedSec >= 60) {'"
mutate "formatClaimAgeCompact seconds branch inverted"

write_pair \
  "r'  if (elapsedMin < 60) {'" \
  "r'  if (elapsedMin >= 60) {'"
mutate "formatClaimAgeCompact minutes branch inverted"

write_pair \
  "r'  if (elapsedHr < 48) {'" \
  "r'  if (elapsedHr >= 48) {'"
mutate "formatClaimAgeCompact hours branch inverted"

write_pair \
  "r'  const parcelCount = heldParcelCount > 1 ? heldParcelCount : undefined;'" \
  "r'  const parcelCount = heldParcelCount > 0 ? heldParcelCount : undefined;'"
mutate "heldParcelCount threshold >1 -> >0"

write_pair \
  "r'  if (!ticketId) {\n    return {};\n  }'" \
  "r'  if (!ticketId) {\n    return { ticketId: \"BL-FAKE\" };\n  }'"
mutate "empty meta -> fake ticket id"

write_pair \
  "r'    if (claimEnteredAtMs !== undefined && (earliest.claimEnteredAtMs === undefined || claimEnteredAtMs < earliest.claimEnteredAtMs)) {'" \
  "r'    if (claimEnteredAtMs !== undefined && (earliest.claimEnteredAtMs === undefined || claimEnteredAtMs > earliest.claimEnteredAtMs)) {'"
mutate "earliest claim comparison inverted"

write_pair \
  "r'    heldParcelCount += 1;'" \
  "r'    heldParcelCount += 0;'"
mutate "heldParcelCount never increments"

write_pair \
  "r'    if (!ticketId) {\n      continue;\n    }'" \
  "r'    if (ticketId) {\n      continue;\n    }'"
mutate "skip parcels with ticket ids"

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]]
