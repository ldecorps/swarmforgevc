#!/usr/bin/env bash
# BL-980 hardener: surgical mutation over formatRecentlyClosedAgeLabel ladder.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BOARD=extension/src/concierge/pipelineBoard.ts
WIRING=(
  bash -c 'cd extension && npx vitest run test/bl980RecentlyClosedElapsed.test.js test/bl980RecentlyClosedElapsed.property.test.js'
)
APS=(bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-980-recently-closed-elapsed-time.feature)

BACKUP="$(mktemp)"
cp "$BOARD" "$BACKUP"
restore() { cp "$BACKUP" "$BOARD"; (cd extension && npm run compile >/dev/null 2>&1) || true; }
cleanup() { restore; rm -f "$BACKUP" /tmp/bl980_from.txt /tmp/bl980_to.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! "${WIRING[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${APS[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate_file() {
  local label="$1"
  restore
  if ! python3 - "$BOARD" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
a = Path('/tmp/bl980_from.txt').read_text()
b = Path('/tmp/bl980_to.txt').read_text()
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
  printf '%b' "$1" > /tmp/bl980_from.txt
  printf '%b' "$2" > /tmp/bl980_to.txt
}

echo "mutation sweep over BL-980 recently-closed age ladder"

write_pair \
  'if (elapsed < MINUTE_MS) {' \
  'if (elapsed <= MINUTE_MS) {'
mutate_file "just-now boundary uses < not <="

write_pair \
  'return `${Math.floor(elapsed / MINUTE_MS)}min ago`;' \
  'return `${Math.ceil(elapsed / MINUTE_MS)}min ago`;'
mutate_file "minute ladder uses floor not ceil"

write_pair \
  'return `${Math.floor(elapsed / HOUR_MS)}h ago`;' \
  'return `${Math.floor(elapsed / MINUTE_MS)}h ago`;'
mutate_file "hour ladder divides by HOUR_MS"

write_pair \
  'return `${Math.floor(elapsed / DAY_MS)}d ago`;' \
  'return `${Math.floor(elapsed / HOUR_MS)}d ago`;'
mutate_file "day ladder divides by DAY_MS"

write_pair \
  'formatRecentlyClosedAgeLabel(closedAtMs: number | undefined, nowMs: number): string | undefined {\n  if (closedAtMs === undefined) {\n    return undefined;' \
  'formatRecentlyClosedAgeLabel(closedAtMs: number | undefined, nowMs: number): string | undefined {\n  if (closedAtMs === undefined) {\n    return "just now";'
mutate_file "missing instant returns just now instead of undefined"

write_pair \
  '  const closedAge = formatRecentlyClosedAgeLabel(item.closedAtMs, nowMs);\n  if (closedAge !== undefined) {\n    entry.closedAge = closedAge;\n  }' \
  '  const closedAge = formatRecentlyClosedAgeLabel(item.closedAtMs, nowMs);\n  entry.closedAge = closedAge ?? "";'
mutate_file "recently closed entry always assigns closedAge property"

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
[[ "$skipped" -eq 0 ]] || exit 1
