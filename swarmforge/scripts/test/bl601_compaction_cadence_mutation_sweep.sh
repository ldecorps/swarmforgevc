#!/usr/bin/env bash
# BL-601 hardener: surgical mutation over compactionCadence + acyclic trend guard.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

BACKUP_ROOT="$(mktemp -d)"
FILES=(
  extension/src/metrics/compactionCadence.ts
  extension/src/metrics/trend.ts
)
for f in "${FILES[@]}"; do
  mkdir -p "$BACKUP_ROOT/$(dirname "$f")"
  cp "$f" "$BACKUP_ROOT/$f"
done

restore() {
  for f in "${FILES[@]}"; do cp "$BACKUP_ROOT/$f" "$f"; done
  (cd extension && npm run compile >/dev/null 2>&1) || true
}
cleanup() { restore; rm -rf "$BACKUP_ROOT" /tmp/bl601_from.txt /tmp/bl601_to.txt /tmp/bl601_target.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run test/compactionCadence.test.js >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run --config vitest.properties.config.mjs test/compactionCadence.property.test.js >/dev/null 2>&1); then return 0; fi
  if ! (bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-601-trend-compaction-cadence.feature >/dev/null 2>&1); then return 0; fi
  return 1
}

mutate_file() {
  local label="$1" target="$2"
  restore
  printf '%s' "$target" > /tmp/bl601_target.txt
  if ! python3 - <<'PY'
from pathlib import Path
target = Path('/tmp/bl601_target.txt').read_text().strip()
a = Path('/tmp/bl601_from.txt').read_text()
b = Path('/tmp/bl601_to.txt').read_text()
s = Path(target).read_text()
if a not in s:
    raise SystemExit(3)
Path(target).write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  python3 -c 'import pathlib,sys; pathlib.Path("/tmp/bl601_from.txt").write_text(sys.argv[1]); pathlib.Path("/tmp/bl601_to.txt").write_text(sys.argv[2])' "$1" "$2"
}

echo "mutation sweep over compaction cadence (BL-601)"

write_pair 'if (!event.compaction) {
    return null;
  }' 'if (false) {
    return null;
  }'
mutate_file "non-compaction events still emit" extension/src/metrics/compactionCadence.ts

write_pair 'tokensAtCompaction: event.inputTokens,' 'tokensAtCompaction: event.contextUtilizationPct,'
mutate_file "tokens taken from util_pct not inputTokens" extension/src/metrics/compactionCadence.ts

write_pair 'if (!detectableRoles.includes(role)) {
      return { role, applicable: false, windows: [], trend: null };
    }' 'if (false) {
      return { role, applicable: false, windows: [], trend: null };
    }'
mutate_file "undetectable roles stay applicable" extension/src/metrics/compactionCadence.ts

write_pair \
  'return input.contextEvents
    .map(deriveCompactionRecordFromContextEvent)
    .filter((record): record is CompactionRecord => record !== null);' \
  'return input.spinnerText
    ? [{ role: "pane", model: "spinner", tokensAtCompaction: 1, timestamp: "t", timestampMs: 0 }]
    : input.contextEvents
        .map(deriveCompactionRecordFromContextEvent)
        .filter((record): record is CompactionRecord => record !== null);'
mutate_file "spinner text invents a compaction record" extension/src/metrics/compactionCadence.ts

write_pair 'export function computeTrend(series: TrendSeriesPoint[]): TrendResult {' \
  "export { trendForCompactionCadencePerHour } from './compactionCadence';
export function computeTrend(series: TrendSeriesPoint[]): TrendResult {"
mutate_file "trend re-exports compactionCadence (cycle)" extension/src/metrics/trend.ts

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
[[ "$skipped" -eq 0 ]] || exit 1
