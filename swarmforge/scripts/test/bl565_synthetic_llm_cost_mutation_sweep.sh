#!/usr/bin/env bash
# BL-565 hardener: surgical mutation over syntheticLlmCost.ts.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC=extension/src/metrics/syntheticLlmCost.ts
UNIT=(npx vitest run test/syntheticLlmCost.test.js)

BACKUP="$(mktemp)"
cp "$SRC" "$BACKUP"
restore() { cp "$BACKUP" "$SRC"; }
cleanup() { restore; rm -f "$BACKUP"; (cd extension && npm run compile >/dev/null 2>&1) || true; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && "${UNIT[@]}" >/dev/null 2>&1); then return 0; fi
  return 1
}

mutate() {
  local label="$1" from="$2" to="$3"
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
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

echo "mutation sweep over $SRC (BL-565)"

mutate "zero estimate allowed" "estimate <= 0" "estimate < 0"
mutate "partial tokens accepted" "if (tokens.inputTokens === null || tokens.outputTokens === null) {
    return null;
  }" ""
mutate "enrich skips null synthetic" "if (derived === null) {
    return record;
  }" "if (false) {
    return record;
  }"
mutate "unknown price needs tokens" "if (!model || !record.tokens) {
    return false;
  }" ""
mutate "billed row may synthesize" "if (record.costUsd !== null) {
    return null;
  }" "if (false) {
    return null;
  }"

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]]
