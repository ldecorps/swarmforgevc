#!/usr/bin/env bash
# BL-428 hardener: surgical mutation over paneHistory detectFooterLineCount decrap slice.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TARGET=extension/src/panel/paneHistory.ts

BACKUP="$(mktemp)"
cp "$TARGET" "$BACKUP"
restore() {
  cp "$BACKUP" "$TARGET"
  (cd extension && npm run compile >/dev/null 2>&1) || true
}
cleanup() { restore; rm -f "$BACKUP" /tmp/bl428_from.txt /tmp/bl428_to.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run test/paneHistory.test.js test/footerDetectionParity.test.js test/footerAwareScroll.test.js >/dev/null 2>&1); then return 0; fi
  return 1
}

mutate_file() {
  local label="$1"
  restore
  if ! python3 - "$TARGET" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
a = Path('/tmp/bl428_from.txt').read_text()
b = Path('/tmp/bl428_to.txt').read_text()
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
  python3 -c 'import pathlib,sys; pathlib.Path("/tmp/bl428_from.txt").write_text(sys.argv[1]); pathlib.Path("/tmp/bl428_to.txt").write_text(sys.argv[2])' "$1" "$2"
}

echo "mutation sweep over paneHistory footer detection (BL-428)"

write_pair \
  'return /^[❯>](\s|$)/.test(trimmed);' \
  'return false;'
mutate_file "prompt line never recognized"

write_pair \
  'return isBracketStatusLine(trimmed) || isInterruptLine(trimmed);' \
  'return true;'
mutate_file "every non-empty line above prompt extends footer"

write_pair \
  'return /^\[.+\]|\[auto\]|\[.*permission/.test(trimmed);' \
  'return false;'
mutate_file "bracket status lines ignored"

write_pair \
  'return /^esc\s+to|^.*interrupt|^.*break/i.test(trimmed);' \
  'return false;'
mutate_file "interrupt hint lines ignored"

write_pair \
  '  for (let i = lines.length - 1; i >= 0; i--) {' \
  '  for (let i = 0; i < lines.length; i++) {'
mutate_file "prompt search scans top-down instead of bottom-up"

write_pair \
  '  if (footerStart === -1) {
    return 0;
  }' \
  '  if (footerStart === -1) {
    return 1;
  }'
mutate_file "no-prompt path returns one footer line"

write_pair \
  '  return lines.length - extendFooterEnd(lines, footerStart);' \
  '  return 1;'
mutate_file "footer count pinned to one regardless of scan"

write_pair \
  '  const minIndex = Math.max(0, footerStart - 5);' \
  '  const minIndex = footerStart;'
mutate_file "footer upward scan window disabled"

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
[[ "$skipped" -eq 0 ]] || exit 1
