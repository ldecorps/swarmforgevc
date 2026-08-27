#!/usr/bin/env bash
# BL-709 hardener: surgical mutation over effectiveLetsTalkMirrorTopicId paths.
# Soft Gherkin covers Scenario Outline bubble-topic-06; this sweep targets the
# parcel's routing helpers in bridgeServer.ts.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

BACKUP_ROOT="$(mktemp -d)"
FILES=(
  extension/src/bridge/bridgeServer.ts
)
for f in "${FILES[@]}"; do
  mkdir -p "$BACKUP_ROOT/$(dirname "$f")"
  cp "$f" "$BACKUP_ROOT/$f"
done

restore() {
  for f in "${FILES[@]}"; do cp "$BACKUP_ROOT/$f" "$f"; done
}
cleanup() { restore; rm -rf "$BACKUP_ROOT" /tmp/bl709_from.txt /tmp/bl709_to.txt /tmp/bl709_target.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run test/letsTalkBridge.test.js -t 'BL-709' >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run test/letsTalkBridge.test.js -t 'BL-718 mirror: short turn' >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run --config vitest.properties.config.mjs test/bl709BubbleOwnTelegramTopic.property.test.js >/dev/null 2>&1); then return 0; fi
  if ! (bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-709-bubble-its-own-telegram-topic.feature >/dev/null 2>&1); then return 0; fi
  return 1
}

apply_mutant() {
  local mode="$1" target="$2"
  python3 - "$target" "$mode" <<'PY'
from pathlib import Path
import sys
target = Path(sys.argv[1])
mode = sys.argv[2]
a = Path('/tmp/bl709_from.txt').read_text()
b = Path('/tmp/bl709_to.txt').read_text()
s = target.read_text()
if a not in s:
    raise SystemExit(3)
count = s.count(a) if mode == 'all' else 1
target.write_text(s.replace(a, b, count))
PY
}

mutate_file() {
  local label="$1" target="$2" mode="${3:-once}"
  restore
  if ! apply_mutant "$mode" "$target"; then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  python3 -c 'import pathlib,sys; pathlib.Path("/tmp/bl709_from.txt").write_text(sys.argv[1]); pathlib.Path("/tmp/bl709_to.txt").write_text(sys.argv[2])' "$1" "$2"
}

echo "mutation sweep over BL-709 Bubble mirror routing (bridgeServer.ts)"

write_pair \
  '  if (bubble !== undefined) {
    return bubble;
  }
  return typeof topicIds.cursorTopicId === '\''number'\'' ? topicIds.cursorTopicId : undefined;' \
  '  return typeof topicIds.cursorTopicId === '\''number'\'' ? topicIds.cursorTopicId : undefined;'
mutate_file "Lets Talk mirror ignores bound Bubble" extension/src/bridge/bridgeServer.ts

write_pair \
  '  return topicIds.bubbleTopicId === topicIds.cursorTopicId ? undefined : topicIds.bubbleTopicId;' \
  '  return topicIds.bubbleTopicId;'
mutate_file "Bubble mirror keeps id when equal to Cursor Remote" extension/src/bridge/bridgeServer.ts

write_pair \
  '  if (topicIds.bubbleTopicId === undefined) {
    return undefined;
  }' \
  '  if (topicIds.bubbleTopicId === undefined) {
    return topicIds.cursorTopicId;
  }'
mutate_file "unbound Bubble pretends Cursor Remote is Bubble" extension/src/bridge/bridgeServer.ts

write_pair \
  '  return typeof topicIds.cursorTopicId === '\''number'\'' ? topicIds.cursorTopicId : undefined;' \
  '  return undefined;'
mutate_file "unbound fallback drops Cursor Remote mirror" extension/src/bridge/bridgeServer.ts

write_pair \
  '  const topicId = effectiveLetsTalkMirrorTopicId(readCursorBridgeTopicIds(targetPath));' \
  '  const topicId = readCursorBridgeTopicIds(targetPath).cursorTopicId;'
mutate_file "mirror paths bypass effectiveLetsTalkMirrorTopicId" extension/src/bridge/bridgeServer.ts all

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
[[ "$skipped" -eq 0 ]] || exit 1
