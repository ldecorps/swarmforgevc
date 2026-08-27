#!/usr/bin/env bash
# BL-600 hardener: surgical mutation over humanDecisionLatency + acyclic trend guard.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

BACKUP_ROOT="$(mktemp -d)"
FILES=(
  extension/src/metrics/humanDecisionLatency.ts
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
cleanup() { restore; rm -rf "$BACKUP_ROOT" /tmp/bl600_from.txt /tmp/bl600_to.txt /tmp/bl600_target.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run test/humanDecisionLatency.test.js >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run --config vitest.properties.config.mjs test/humanDecisionLatency.property.test.js >/dev/null 2>&1); then return 0; fi
  if ! (bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-600-trend-human-decision-latency.feature >/dev/null 2>&1); then return 0; fi
  return 1
}

mutate_file() {
  local label="$1" target="$2"
  restore
  printf '%s' "$target" > /tmp/bl600_target.txt
  if ! python3 - <<'PY'
from pathlib import Path
target = Path('/tmp/bl600_target.txt').read_text().strip()
a = Path('/tmp/bl600_from.txt').read_text()
b = Path('/tmp/bl600_to.txt').read_text()
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
  python3 -c 'import pathlib,sys; pathlib.Path("/tmp/bl600_from.txt").write_text(sys.argv[1]); pathlib.Path("/tmp/bl600_to.txt").write_text(sys.argv[2])' "$1" "$2"
}

echo "mutation sweep over human decision latency (BL-600)"

write_pair 'if (verdictAtMs !== undefined && verdictAtMs >= askAtMs) {
    return { ticketId, gate, latencyMs: verdictAtMs - askAtMs };
  }' 'if (false) {
    return { ticketId, gate, latencyMs: verdictAtMs - askAtMs };
  }'
mutate_file "decided tickets never yield latencyMs" extension/src/metrics/humanDecisionLatency.ts

write_pair 'return { ticketId, gate, openAgeMs: Math.max(0, nowMs - askAtMs) };' \
  'return { ticketId, gate, latencyMs: Math.max(0, nowMs - askAtMs) };'
mutate_file "pending asks fabricate latencyMs" extension/src/metrics/humanDecisionLatency.ts

write_pair 'outliersMs: outliers,' 'outliersMs: [],'
mutate_file "extreme latencies dropped from outliers" extension/src/metrics/humanDecisionLatency.ts

write_pair 'latencyMs: verdictAtMs - askAtMs' 'latencyMs: askAtMs - verdictAtMs'
mutate_file "latency subtracts ask from verdict reversed" extension/src/metrics/humanDecisionLatency.ts

write_pair 'export function computeTrend(series: TrendSeriesPoint[]): TrendResult {' \
  "export { trendForDecisionLatencyMedian } from './humanDecisionLatency';
export function computeTrend(series: TrendSeriesPoint[]): TrendResult {"
mutate_file "trend re-exports humanDecisionLatency (cycle)" extension/src/metrics/trend.ts

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
[[ "$skipped" -eq 0 ]] || exit 1
