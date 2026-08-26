#!/usr/bin/env bash
# BL-1046 hardener: surgical mutation over residentSpyUiHtml.ts grid tile head.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC=extension/src/bridge/residentSpyUiHtml.ts
UNIT=(npx vitest run test/residentSpyUiHtml.test.js test/bl994LiveScreenGrid.test.js)
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
a = Path('/tmp/bl1046ui_from.txt').read_text()
b = Path('/tmp/bl1046ui_to.txt').read_text()
if a not in s:
    sys.exit(3)
p.write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  python3 -c "open('/tmp/bl1046ui_from.txt','w').write($1); open('/tmp/bl1046ui_to.txt','w').write($2)"
}

echo "mutation sweep over $SRC grid tile head (BL-1046)"

write_pair \
  "r'    if (pane && pane.available !== false && pane.ticketId) {'" \
  "r'    if (pane && pane.available === false && pane.ticketId) {'"
mutate "buildGridTileHeadHtml shows ticket only when unavailable"

write_pair \
  "r'      if (pane.heldParcelCount && pane.heldParcelCount > 1) {'" \
  "r'      if (pane.heldParcelCount && pane.heldParcelCount > 0) {'"
mutate "grid +N shown for single parcel"

write_pair \
  "r\"        html += '<span class=\\\"pane-grid-more\\\">+' + (pane.heldParcelCount - 1) + '</span>';\"" \
  "r\"        html += '<span class=\\\"pane-grid-more\\\">+' + pane.heldParcelCount + '</span>';\""
mutate "grid +N uses full count not rest"

write_pair \
  "r'    if (elapsedSec < 60) return elapsedSec + \\'s\\';'" \
  "r'    if (elapsedSec >= 60) return elapsedSec + \\'s\\';'"
mutate "inline formatClaimAgeCompact seconds branch inverted"

write_pair \
  "r'      if (pane.claimEnteredAtMs) {'" \
  "r'      if (!pane.claimEnteredAtMs) {'"
mutate "claim age rendered when absent"

write_pair \
  "r\"      html += '<span class=\\\"pane-grid-ticket-id\\\">' + escapeHtml(pane.ticketId) + '</span>';\n      if (pane.ticketTitle) {\"" \
  "r\"      html += '<span class=\\\"pane-grid-ticket-id\\\">' + escapeHtml(pane.ticketId) + '</span>';\n      if (!pane.ticketTitle) {\""
mutate "slug rendered when title absent"

write_pair \
  "r'    headEl.innerHTML = buildGridTileHeadHtml(pane, label);'" \
  "r'    headEl.innerHTML = \"\";'"
mutate "renderPane clears grid head"

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]]
