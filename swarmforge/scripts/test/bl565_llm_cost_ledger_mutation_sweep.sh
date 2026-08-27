#!/usr/bin/env bash
# BL-565 hardener: surgical mutation over llmCostLedger.ts synthetic rollups.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC=extension/src/metrics/llmCostLedger.ts
UNIT=(npx vitest run test/syntheticLlmCost.test.js test/llmCostLedger.test.js)

BACKUP="$(mktemp)"
cp "$SRC" "$BACKUP"
restore() { cp "$BACKUP" "$SRC"; }
cleanup() { restore; rm -f "$BACKUP"; (cd extension && npm run compile >/dev/null 2>&1) || true; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
equivalent=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && "${UNIT[@]}" >/dev/null 2>&1); then return 0; fi
  return 1
}

mutate() {
  local label="$1" from="$2" to="$3"
  local equiv="${4:-}"
  restore
  if ! python3 - "$SRC" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
if a not in s:
    sys.exit(3)
open(p, 'w').write(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  if [[ -n "$equiv" ]]; then echo "  EQUIV    $label"; equivalent=$((equivalent + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

echo "mutation sweep over $SRC (BL-565)"

mutate "billed synthetic zero" "if (record.costUsd !== null) {
    return 0;
  }" "if (false) {
    return 0;
  }" "syntheticUsd only called when both ranked rows have null costUsd"
mutate "rank by synthetic desc" "const synthDiff = syntheticUsd(b) - syntheticUsd(a);" "const synthDiff = syntheticUsd(a) - syntheticUsd(b);"
mutate "unknown null cost after priced" "if (a.costUsd === null) {
    return 1;
  }" "if (false) {
    return 1;
  }"
mutate "total synthetic accumulates" "totalSyntheticCostUsd += synth;" "totalSyntheticCostUsd += 0;"
mutate "billed adds to totalCostUsd" "totalCostUsd += record.costUsd;" "totalCostUsd += 0;"
mutate "rollup synthetic separate" "group.syntheticCostUsd += synth;" "group.syntheticCostUsd += 0;"

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped equivalent=$equivalent"
[[ "$survived" -eq 0 ]]
