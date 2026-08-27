#!/usr/bin/env bash
# BL-941 coder: surgical mutation over isCursorAgentGone / shouldResetCursorAgentSession.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CORE=extension/src/tools/telegramCursorBridgeCore.ts
UNIT=(npx vitest run test/telegramCursorBridgeCore.test.js)
PROP=(npm run test:properties -- test/bl941CursorGoneAgentClassifierInvariants.property.test.js)
FEATURE=specs/features/BL-941-cursor-gone-agent-classifier-boundaries.feature
ACCEPT=(bash specs/pipeline/scripts/run_acceptance.sh "$FEATURE")

BACKUP="$(mktemp)"
cp "$CORE" "$BACKUP"
restore() { cp "$BACKUP" "$CORE"; (cd extension && npm run compile >/dev/null 2>&1); }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && "${UNIT[@]}" >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && "${PROP[@]}" >/dev/null 2>&1); then return 0; fi
  if ! "${ACCEPT[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate() {
  local label="$1" from="$2" to="$3"
  cp "$BACKUP" "$CORE"
  if ! python3 - "$CORE" "$from" "$to" <<'PY'
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

echo "BL-941 surgical mutation sweep over $CORE"

mutate "drop case-insensitivity (/i)" \
  'return /\bagent\s+agent-[a-z0-9-]+\s+not found\b/i.test(message);' \
  'return /\bagent\s+agent-[a-z0-9-]+\s+not found\b/.test(message);'

mutate "drop trailing word boundary before not found" \
  'return /\bagent\s+agent-[a-z0-9-]+\s+not found\b/i.test(message);' \
  'return /\bagent\s+agent-[a-z0-9-]+\s+not found/i.test(message);'

mutate "drop leading agent word boundary" \
  'return /\bagent\s+agent-[a-z0-9-]+\s+not found\b/i.test(message);' \
  'return /agent\s+agent-[a-z0-9-]+\s+not found\b/i.test(message);'

mutate "shouldResetCursorAgentSession drops isCursorAgentGone arm" \
  '    isCursorAgentGone(message)' \
  '    false /* mutant */'

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
printf 'survivors: %s\n' "${SURVIVORS[*]:-none}"
test "$survived" -eq 0
