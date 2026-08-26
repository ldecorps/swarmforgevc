#!/usr/bin/env bash
# BL-988 hardender: surgical mutation over bl988Bl578ContractBinding.property.test.js.
#
# Soft Gherkin on BL-578 Outline Examples: 2/2 SURVIVED as BL-234 equivalents
# (example path is threaded into both command construction and includes()).
# This sweep locks the BL-988 binding contract itself.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=specs/pipeline/test/bl988Bl578ContractBinding.property.test.js
PROP=(node --test "$LIB")
ACCEPT=(bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-578-devhost-bounce-wsl-window-leak.feature)

BACKUP="$(mktemp)"
cp "$LIB" "$BACKUP"
restore() { cp "$BACKUP" "$LIB"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()

suite_fails() {
  if ! "${PROP[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate() {
  local label="$1" from="$2" to="$3"
  restore
  if ! python3 - "$LIB" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
if a not in s:
    sys.exit(3)
open(p, 'w').write(s.replace(a, b, 1))
PY
  then
    echo "  skip     $label (anchor not found)"
    skipped=$((skipped + 1)); return
  fi
  if suite_fails; then
    echo "  killed   $label"
    killed=$((killed + 1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label")
  survived=$((survived + 1))
}

echo "mutation sweep over $LIB"

mutate "index regex never matches" \
  '/bl578DevhostBounceWslWindowLeakSteps/' \
  '/bl578NeverRegisteredModule/'

mutate "registerSteps never called" \
  'registerSteps(registry);' \
  '// registerSteps(registry);'

mutate "feature name mismatch" \
  "const FEATURE_NAME =
  'dev-host bounce under WSL terminates the prior Windows-side window instead of leaking it';" \
  "const FEATURE_NAME =
  'some other feature that does not exist';"

mutate "steps floor raised to impossible" \
  'assert.ok(steps.length >= 10, `expected many steps, got ${steps.length}`);' \
  'assert.ok(steps.length >= 999, `expected many steps, got ${steps.length}`);'

mutate "resolve forced null before assert" \
  'const resolved = registry.resolve(stepText, FEATURE_NAME);' \
  'const resolved = null; // mutated: drop resolve'

mutate "FEATURE_PATH points at missing feature" \
  "'BL-578-devhost-bounce-wsl-window-leak.feature'" \
  "'BL-578-does-not-exist.feature'"

echo
echo "killed=$killed survived=$survived skipped=$skipped"
if (( survived > 0 )); then
  echo "SURVIVORS:"
  printf '  - %s\n' "${SURVIVORS[@]}"
  exit 1
fi
restore
"${ACCEPT[@]}" >/dev/null 2>&1 || { echo "ACCEPTANCE REGRESSED"; exit 1; }
echo "acceptance: still green after restore"
exit 0
