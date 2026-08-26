#!/usr/bin/env bash
# BL-589 hardener: surgical mutation over ruling-option approval ask wiring.
# Soft Gherkin inapplicable (no Scenario Outline).
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TOPIC_ROUTER=extension/src/concierge/topicRouter.ts
PENDING_REPLY=extension/src/concierge/pendingApprovalReply.ts
BOT_CORE=extension/src/tools/telegramFrontDeskBotCore.ts
WIRING=(
  bash -c 'cd extension && npm run compile && npx vitest run test/backlogReader.test.js test/conciergeTopicRouting.test.js test/pendingApprovalReply.test.js test/telegramFrontDeskBotCore.test.js test/approvalAskClosing.test.js'
  bash -c 'cd extension && npx vitest run --config vitest.properties.config.mjs test/approvalAskClosing.property.test.js'
)
APS=(bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-589-approval-ask-carries-ruling-options.feature)

BACKUP_TR="$(mktemp)"
BACKUP_PR="$(mktemp)"
BACKUP_BC="$(mktemp)"
cp "$TOPIC_ROUTER" "$BACKUP_TR"
cp "$PENDING_REPLY" "$BACKUP_PR"
cp "$BOT_CORE" "$BACKUP_BC"
restore() {
  cp "$BACKUP_TR" "$TOPIC_ROUTER"
  cp "$BACKUP_PR" "$PENDING_REPLY"
  cp "$BACKUP_BC" "$BOT_CORE"
  (cd extension && npm run compile >/dev/null 2>&1) || true
}
cleanup() { restore; rm -f "$BACKUP_TR" "$BACKUP_PR" "$BACKUP_BC" /tmp/bl589_from.txt /tmp/bl589_to.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! "${WIRING[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${APS[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate_file() {
  local file="$1" label="$2"
  restore
  if ! python3 - "$file" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
a = Path('/tmp/bl589_from.txt').read_text()
b = Path('/tmp/bl589_to.txt').read_text()
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
  printf '%s' "$1" > /tmp/bl589_from.txt
  printf '%s' "$2" > /tmp/bl589_to.txt
}

echo "mutation sweep over BL-589 ruling-option approval ask"

write_pair \
  'callbackData: `rule:${backlogId}:${index}`' \
  'callbackData: `rule:${backlogId}:${label}`'
mutate_file "$TOPIC_ROUTER" "callback_data embeds label instead of index"

write_pair \
  'const optionRows = rulingOptions && rulingOptions.length > 0 ? rulingOptionButtonRows(backlogId, rulingOptions) : [];' \
  'const optionRows: InlineKeyboardButton[][] = [];'
mutate_file "$TOPIC_ROUTER" "drop ruling-option rows when options declared"

write_pair \
  'return `human_ruling: |\n  ${sanitized}\n`;' \
  'return "";'
mutate_file "$PENDING_REPLY" "drop human_ruling block emission"

write_pair \
  'const RULE_CALLBACK_DATA_PATTERN = /^rule:([^:]+):(\d+)$/;' \
  'const RULE_CALLBACK_DATA_PATTERN = /^rule:([^:]+):(.+)$/;'
mutate_file "$BOT_CORE" "rule callback accepts non-index tail"

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
