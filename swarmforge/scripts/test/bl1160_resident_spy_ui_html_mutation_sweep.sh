#!/usr/bin/env bash
# BL-1160 hardener: surgical mutation over per-tile activity dot resolution.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC="$ROOT/extension/src/bridge/residentSpyUiHtml.ts"
EXT="$ROOT/extension"
APS=(bash "$ROOT/specs/pipeline/scripts/run_acceptance.sh"
  "$ROOT/specs/features/BL-1160-live-screen-activity-dot-per-tile.feature")

BACKUP="$(mktemp)"
cp "$SRC" "$BACKUP"
restore() { cp "$BACKUP" "$SRC"; }
cleanup() { restore; rm -f "$BACKUP" /tmp/bl1160_from.txt /tmp/bl1160_to.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd "$EXT" && npm run compile >/dev/null 2>&1 && npx vitest run test/residentSpyUiHtml.test.js >/dev/null 2>&1); then
    return 0
  fi
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
a = Path('/tmp/bl1160_from.txt').read_text()
b = Path('/tmp/bl1160_to.txt').read_text()
s = p.read_text()
if a not in s:
    sys.exit(3)
p.write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  printf '%s' "$1" > /tmp/bl1160_from.txt
  printf '%s' "$2" > /tmp/bl1160_to.txt
}

echo "mutation sweep over residentSpyUiHtml per-tile dots (BL-1160)"

write_pair \
  'return pane.activitySignal;' \
  "return 'ok';"
mutate "resolvePaneStatusKind ignores explicit activitySignal"

write_pair \
  '  function resolvePaneStatusKind(pane, aggregateKind) {
    if (pane && pane.activitySignal) {
      return pane.activitySignal;
    }
    if (!pane || pane.available === false) {
      return null;
    }' \
  '  function resolvePaneStatusKind(pane, aggregateKind) {
    if (pane && pane.activitySignal) {
      return pane.activitySignal;
    }
    if (false) {
      return null;
    }'
mutate "resolvePaneStatusKind never treats unavailable panes as hidden"

write_pair \
  'if (!kind) {
      hideDot(dotEl);
      return;
    }
    applyDotState(dotEl, kind);' \
  'applyDotState(dotEl, kind || "ok");'
mutate "updatePaneStatusDot shows ok when kind is null"

write_pair \
  'updatePaneStatusDot(headEl, lastPanes[i].pane, aggregateKind);' \
  'void aggregateKind;'
mutate "updateAllPaneStatusDots skips per-pane dot refresh"

echo "mutants: killed=$killed survived=$survived skipped=$skipped"
if [[ "$survived" -gt 0 ]]; then exit 1; fi
if [[ "$skipped" -gt 0 ]]; then exit 1; fi
echo "ALL MUTANTS KILLED"
exit 0
