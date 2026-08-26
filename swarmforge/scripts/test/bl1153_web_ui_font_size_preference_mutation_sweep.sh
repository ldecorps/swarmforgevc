#!/usr/bin/env bash
# BL-1153 hardener: surgical mutation over host-persisted font preference module.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC="$ROOT/extension/src/bridge/webUiFontSizePreference.ts"
EXT="$ROOT/extension"

BACKUP="$(mktemp)"
cp "$SRC" "$BACKUP"
restore() { cp "$BACKUP" "$SRC"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd "$EXT" && npm run compile >/dev/null 2>&1 && npx vitest run test/webUiFontSizePreference.test.js >/dev/null 2>&1); then
    return 0
  fi
  return 1
}

mutate() {
  local label="$1"
  restore
  if ! python3 - "$SRC" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
a = Path('/tmp/bl1153_from.txt').read_text()
b = Path('/tmp/bl1153_to.txt').read_text()
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
  printf '%s' "$1" > /tmp/bl1153_from.txt
  printf '%s' "$2" > /tmp/bl1153_to.txt
}

echo "mutation sweep over webUiFontSizePreference (BL-1153)"

write_pair \
  'return WEB_UI_FONT_SIZE_BOUNDS[surface].default;' \
  'return WEB_UI_FONT_SIZE_BOUNDS[surface].default + 1;'
mutate "resolveWebUiFontSizePx fallback returns wrong default"

write_pair \
  "? { kind: 'unreadable' } : { kind: 'none' }" \
  "? { kind: 'none' } : { kind: 'none' }"
mutate "corrupt preference file misclassified as missing"

write_pair \
  'return bounds.max;' \
  'return bounds.max + 1;'
mutate "pipeline-grid upper clamp allows value above max"

write_pair \
  "return { kind: 'none' };" \
  "return { kind: 'stored', fontSizePx: 13 };"
mutate "non-number stored value treated as valid"

echo "mutants: killed=$killed survived=$survived skipped=$skipped"
if [[ "$survived" -gt 0 ]]; then exit 1; fi
if [[ "$skipped" -gt 0 ]]; then exit 1; fi
echo "ALL MUTANTS KILLED"
exit 0
