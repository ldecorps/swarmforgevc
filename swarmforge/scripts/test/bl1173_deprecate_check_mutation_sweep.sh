#!/usr/bin/env bash
# BL-1173 hardener: surgical mutation over deprecate-check freshness evaluator.
# Soft Gherkin inapplicable (no Scenario Outline) — BL-638 hand-authored sweep.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=extension/src/tools/deprecate-check.ts

BACKUP="$(mktemp)"
cp "$LIB" "$BACKUP"
restore() { cp "$BACKUP" "$LIB"; (cd extension && npm run compile >/dev/null 2>&1) || true; }
cleanup() { restore; rm -f "$BACKUP" /tmp/bl1173_from.txt /tmp/bl1173_to.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run test/deprecateCheck.test.js >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run --config vitest.properties.config.mjs test/deprecateCheck.property.test.js >/dev/null 2>&1); then return 0; fi
  if ! (bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1173-deprecator-freshness-gate-cli.feature >/dev/null 2>&1); then return 0; fi
  return 1
}

mutate_file() {
  local label="$1"
  restore
  if ! python3 - "$LIB" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
a = Path('/tmp/bl1173_from.txt').read_text()
b = Path('/tmp/bl1173_to.txt').read_text()
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
  python3 -c 'import pathlib,sys; pathlib.Path("/tmp/bl1173_from.txt").write_text(sys.argv[1]); pathlib.Path("/tmp/bl1173_to.txt").write_text(sys.argv[2])' "$1" "$2"
}

echo "mutation sweep over deprecate-check freshness (BL-1173)"

write_pair \
  'if (facts.supersedeMarkerPath) {
    return hold(`supersede marker present: ${facts.supersedeMarkerPath}`);
  }' \
  'if (false) {
    return hold(`supersede marker present: ${facts.supersedeMarkerPath}`);
  }'
mutate_file "supersede marker hold never fires"

write_pair \
  'if (facts.dependsOnAllDone && facts.retiredSurfaceHits.length > 0) {' \
  'if (false) {'
mutate_file "retired-surface stale premise hold disabled"

write_pair \
  "return { decision: 'allow' };" \
  "return { decision: 'hold', reason: 'forced' };"
mutate_file "clean ticket forced to hold"

write_pair \
  "return decision.decision === 'allow';" \
  'return true;'
mutate_file "expedite may promote despite hold"

write_pair \
  "return hold('empty deprecate-check output — fail closed');" \
  "return { decision: 'allow' };"
mutate_file "empty CLI output treated as allow"

write_pair \
  "return hold('malformed deprecate-check output — fail closed');" \
  "return { decision: 'allow' };"
mutate_file "malformed CLI output treated as allow"

write_pair \
  'return { staysPaused: true, notifySpecifierPriority00: true };' \
  'return { staysPaused: false, notifySpecifierPriority00: false };'
mutate_file "hold side effects claim not paused"

write_pair \
  'if (facts.specGapBounceCount >= 2) {' \
  'if (false) {'
mutate_file "spec-gap bounce hold disabled"

write_pair \
  'if (STALE_CLAIM_RE.test(facts.yamlText) && !facts.doneClosureExists) {' \
  'if (false) {'
mutate_file "stale claim hold disabled"

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
[[ "$skipped" -eq 0 ]] || exit 1
