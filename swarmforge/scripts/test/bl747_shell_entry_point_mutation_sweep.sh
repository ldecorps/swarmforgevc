#!/usr/bin/env bash
# BL-747 hardener: surgical mutation over shellEntryPointDriveCheck.ts (BL-638).
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC=extension/src/tools/shellEntryPointDriveCheck.ts
UNIT=(node --test extension/test/shellEntryPointDriveCheck.test.js)
PROP=(node --test extension/test/shellEntryPointDriveCheck.property.test.js)

BACKUP="$(mktemp)"
cp "$SRC" "$BACKUP"
restore() { cp "$BACKUP" "$SRC"; }
cleanup() { restore; rm -f "$BACKUP"; (cd extension && npm run compile >/dev/null 2>&1) || true; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! "${UNIT[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${PROP[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate() {
  local label="$1" from="$2" to="$3"
  restore
  if ! python3 - "$SRC" "$from" "$to" <<'PY'
import sys
p,a,b=sys.argv[1],sys.argv[2],sys.argv[3]
s=open(p).read()
if a not in s: sys.exit(3)
open(p,'w').write(s.replace(a,b,1))
PY
  then echo "  skip     $label"; skipped=$((skipped+1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed+1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived+1))
}

echo "mutation sweep over $SRC (BL-747)"
mutate "source counts as invoke (OR true)" \
  'return bashOrSh.test(code) || dotSlash.test(code);' \
  'return true;'
mutate "invoke check always false" \
  'return bashOrSh.test(code) || dotSlash.test(code);' \
  'return false;'
mutate "no-op when either empty becomes AND" \
  'if (entryPoints.length === 0 || shellTests.length === 0)' \
  'if (entryPoints.length === 0 && shellTests.length === 0)'
mutate "fail-open undefined becomes refuse-shaped empty" \
  'if (input.ticketYaml === undefined || input.shellTests === undefined) {
    return { checked: false };
  }' \
  'if (input.ticketYaml === undefined || input.shellTests === undefined) {
    return { checked: true, shellTestsScanned: 0, entryPointsNamed: 0 };
  }'
echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]]
