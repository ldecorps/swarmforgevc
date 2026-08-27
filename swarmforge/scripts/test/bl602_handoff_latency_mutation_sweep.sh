#!/usr/bin/env bash
# BL-602 hardener: surgical mutation over handoffLatency + acyclic trend guard.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

BACKUP_ROOT="$(mktemp -d)"
FILES=(
  extension/src/metrics/handoffLatency.ts
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
cleanup() { restore; rm -rf "$BACKUP_ROOT" /tmp/bl602_from.txt /tmp/bl602_to.txt /tmp/bl602_target.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run test/handoffLatency.test.js >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run --config vitest.properties.config.mjs test/handoffLatencyInvariants.property.test.js >/dev/null 2>&1); then return 0; fi
  if ! (bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-602-trend-handoff-latency.feature >/dev/null 2>&1); then return 0; fi
  return 1
}

mutate_file() {
  local label="$1" target="$2"
  restore
  printf '%s' "$target" > /tmp/bl602_target.txt
  if ! python3 - <<'PY'
from pathlib import Path
target = Path('/tmp/bl602_target.txt').read_text().strip()
a = Path('/tmp/bl602_from.txt').read_text()
b = Path('/tmp/bl602_to.txt').read_text()
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
  python3 -c 'import pathlib,sys; pathlib.Path("/tmp/bl602_from.txt").write_text(sys.argv[1]); pathlib.Path("/tmp/bl602_to.txt").write_text(sys.argv[2])' "$1" "$2"
}

echo "mutation sweep over handoff latency (BL-602)"

write_pair 'if (dequeuedAtMs !== null && dequeuedAtMs >= enqueuedAtMs)' \
  'if (false && dequeuedAtMs !== null && dequeuedAtMs >= enqueuedAtMs)'
mutate_file "processed handoffs never yield latencyMs" extension/src/metrics/handoffLatency.ts

write_pair "status: 'open',
    openWaitMs: Math.max(0, nowMs - enqueuedAtMs)," \
  "status: 'processed',
    latencyMs: Math.max(0, nowMs - enqueuedAtMs),"
mutate_file "open wait fabricates processed latencyMs" extension/src/metrics/handoffLatency.ts

write_pair 'outliersMs: outliers,' 'outliersMs: [],'
mutate_file "extreme latencies dropped from outliers" extension/src/metrics/handoffLatency.ts

write_pair 'latencyMs: dequeuedAtMs - enqueuedAtMs' 'latencyMs: enqueuedAtMs - dequeuedAtMs'
mutate_file "latency subtracts enqueue from dequeue reversed" extension/src/metrics/handoffLatency.ts

write_pair 'export function computeTrend(series: TrendSeriesPoint[]): TrendResult {' \
  "export { trendForHandoffLatencyMedian } from './handoffLatency';
export function computeTrend(series: TrendSeriesPoint[]): TrendResult {"
mutate_file "trend re-exports handoffLatency (cycle)" extension/src/metrics/trend.ts

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
[[ "$skipped" -eq 0 ]] || exit 1
