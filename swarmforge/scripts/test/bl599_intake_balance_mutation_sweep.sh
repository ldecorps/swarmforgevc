#!/usr/bin/env bash
# BL-599 hardener: surgical mutation over deliveryMetrics intake-balance paths.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=extension/src/metrics/deliveryMetrics.ts
PROP=extension/test/deliveryMetricsIntakeBalance.property.test.js

BACKUP="$(mktemp)"
cp "$LIB" "$BACKUP"
restore() { cp "$BACKUP" "$LIB"; (cd extension && npm run compile >/dev/null 2>&1) || true; }
cleanup() { restore; rm -f "$BACKUP" /tmp/bl599_from.txt /tmp/bl599_to.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run --config vitest.properties.config.mjs test/deliveryMetricsIntakeBalance.property.test.js >/dev/null 2>&1); then return 0; fi
  if ! (bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-599-trend-intake-balance.feature >/dev/null 2>&1); then return 0; fi
  return 1
}

mutate_file() {
  local label="$1"
  restore
  if ! python3 - "$LIB" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
a = Path('/tmp/bl599_from.txt').read_text()
b = Path('/tmp/bl599_to.txt').read_text()
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
  printf '%b' "$1" > /tmp/bl599_from.txt
  printf '%b' "$2" > /tmp/bl599_to.txt
}

echo "mutation sweep over deliveryMetrics intake balance (BL-599)"

write_pair \
  'return /\\/BL-\\d+-epic-[^/]+\\.ya?ml$/i.test(filePath);' \
  'return false;'
mutate_file "epic tracker filter disabled"

write_pair \
  'return /^backlog\\/INTAKE-[^/]+\\.md$/i.test(filePath);' \
  'return false;'
mutate_file "root INTAKE path never filed"

write_pair \
  'if (isBuildableTicketDonePath(change.path)) {' \
  'if (false) {'
mutate_file "done-path closes never recorded"

write_pair \
  'return /^backlog\\/(active|paused)\\/BL-\\d+[^/]*\\.ya?ml$/i.test(filePath) && !isEpicTrackerPath(filePath);' \
  'return /^backlog\\/(active|paused)\\/BL-\\d+[^/]*\\.ya?ml$/i.test(filePath);'
mutate_file "buildable ticket intake includes epics"

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
[[ "$skipped" -eq 0 ]] || exit 1
