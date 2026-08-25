#!/usr/bin/env bash
# BL-1146 hardener: surgical mutation over telegramCursorBridgeCore.ts (BL-1146 fns).
#
# Soft Gherkin is BL-638 inapplicable (plain Scenarios). Each mutant is a
# single edit the property + APS suites must reject.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CORE=extension/src/tools/telegramCursorBridgeCore.ts
PROP=(node --test extension/test/bl1146HostQueueEnqueueNext.property.test.js)
FEATURE=specs/features/BL-1146-host-queue-enqueue-next-hold-on-host-question.feature
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
  if ! "${PROP[@]}" >/dev/null 2>&1; then return 0; fi
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

echo "mutation sweep over $CORE (BL-1146)"

mutate "hold-pin ignored (question -> auto-start)" \
  '    if (hostFinishingReplyIsQuestion) {
      return { kind: '\''hold-pin'\'' };
    }' \
  '    if (false) {
      return { kind: '\''hold-pin'\'' };
    }'

mutate "auto-start wrong item id" \
  "return { kind: 'auto-start', itemId: enqueueNextPromptId };" \
  "return { kind: 'auto-start', itemId: 'wrong-id' };"

mutate "stale pin does not clear" \
  "return pendingPrompts.length > 0 ? { kind: 'clear-stale-pin-then-poll' } : { kind: 'hold-pin' };" \
  "return { kind: 'hold-pin' };"

mutate "no-pin falls through to hold instead of poll" \
  "return { kind: 'post-choose-next-poll' };" \
  "return { kind: 'hold-pin' };"

mutate "hostReplyTextIsQuestion never detects ?" \
  '  if (/[?]$/.test(last)) {
    return true;
  }' \
  '  if (false) {
    return true;
  }'

mutate "clearEnqueueNextIfStale keeps stale pin" \
  '  return { ...state, enqueueNextPromptId: undefined };' \
  '  return state;'

mutate "enqueue ack message drops idle clause" \
  'Will start when idle.' \
  'Will start now.'

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
printf 'survivors: %s\n' "${SURVIVORS[*]:-none}"
