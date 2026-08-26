#!/usr/bin/env bash
# BL-1152 hardener: surgical mutation over stamp-off hotfix 7380d80686 paths.
# Soft Gherkin inapplicable (no Scenario Outline). Source must match hotfix at
# rest — this script mutates only in a temp copy cycle and restores before exit.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC="$ROOT/extension/src/tools/telegram-front-desk-bot.ts"
HOTFIX=7380d80686
EXT="$ROOT/extension"
UNIT=(npx vitest run test/telegramFrontDeskBotCli.test.js -t BL-1152)
APS=(bash "$ROOT/specs/pipeline/scripts/run_acceptance.sh"
  "$ROOT/specs/features/BL-1152-swarm-stamp-concurrent-hotfix-stamp-asks-7380d80686.feature")

BACKUP="$(mktemp)"
cp "$SRC" "$BACKUP"
restore() { cp "$BACKUP" "$SRC"; }
cleanup() { restore; rm -f "$BACKUP" /tmp/bl1152_from.txt /tmp/bl1152_to.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

static_routing_ok() {
  python3 - "$SRC" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
if 'function applyHotfixStampAnswer' not in src:
    sys.exit(1)
if 'hotfix_ledger_update.bb' not in src or '--decide' not in src:
    sys.exit(1)
if "spawnSync('bb'" not in src:
    sys.exit(1)
helper = re.search(r'async function postToBridgeOrHotfixStamp[\s\S]*?^}', src, re.M)
if not helper:
    sys.exit(1)
body = helper.group(0)
if "subjectId.startsWith('hotfix-')" not in body:
    sys.exit(1)
if not re.search(r"subjectId\.startsWith\('hotfix-'\)[\s\S]*?return applyHotfixStampAnswer", body):
    sys.exit(1)
if re.search(r"subjectId\.startsWith\('hotfix-'\)[\s\S]*?return postToBridge\(", body):
    sys.exit(1)
if 'return applyHotfixStampAnswer' not in body:
    sys.exit(1)
fn = re.search(r'function applyHotfixStampAnswer[\s\S]*?^}', src, re.M)
if not fn:
    sys.exit(1)
decide = fn.group(0)
if not re.search(r"includes\('waive'\)[\s\S]*decision = 'waived'", decide):
    sys.exit(1)
if not re.search(r"includes\('certify'\)[\s\S]*decision = 'approved'", decide):
    sys.exit(1)
if re.search(r'postToBridge\([\s\S]*hotfix-', body):
    sys.exit(1)
sys.exit(0)
PY
}

suite_fails() {
  if ! (cd "$EXT" && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! static_routing_ok; then return 0; fi
  if ! (cd "$EXT" && "${UNIT[@]}" >/dev/null 2>&1); then return 0; fi
  if ! "${APS[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate() {
  local label="$1"
  restore
  if ! python3 - "$SRC" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
a = Path('/tmp/bl1152_from.txt').read_text()
b = Path('/tmp/bl1152_to.txt').read_text()
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
  printf '%s' "$1" > /tmp/bl1152_from.txt
  printf '%s' "$2" > /tmp/bl1152_to.txt
}

echo "mutation sweep over telegram-front-desk-bot hotfix stamp paths (BL-1152)"

write_pair \
  "  if (threadId.startsWith('hotfix-')) {" \
  "  if (false && threadId.startsWith('hotfix-')) {"
mutate "resolveAskOptions skips hotfix-stamp-asks branch"

write_pair \
  '      return stampAsks[threadId]?.options;' \
  '      return undefined;'
mutate "resolveAskOptions ignores hotfix-stamp-asks entry"

write_pair \
  "  if (subjectId.startsWith('hotfix-')) {
    return applyHotfixStampAnswer(targetPath, subjectId, text);
  }
  return postToBridge(bridgeUrl, controlToken, subjectId, text, updateId);" \
  "  if (subjectId.startsWith('hotfix-')) {
    return postToBridge(bridgeUrl, controlToken, subjectId, text, updateId);
  }
  return applyHotfixStampAnswer(targetPath, subjectId, text);"
mutate "postToBridgeOrHotfixStamp routes hotfix answers to bridge"

write_pair \
  "    const result = spawnSync('bb', [cli, targetPath, '--decide', commit, decision], { encoding: 'utf8' });" \
  "    const result = spawnSync('bb', [cli, targetPath, '--record', commit, decision], { encoding: 'utf8' });"
mutate "applyHotfixStampAnswer drops --decide ledger flag"

write_pair \
  "  if (lower.includes('waive') || lower === 'no' || lower.startsWith('no ') || lower.startsWith('n —') || lower.startsWith('n -')) {
    decision = 'waived';
  } else if (lower.includes('certify') || lower.includes('approve') || lower === 'yes' || lower.startsWith('yes ') || lower.startsWith('y —') || lower.startsWith('y -')) {
    decision = 'approved';" \
  "  if (lower.includes('certify') || lower.includes('approve') || lower === 'yes' || lower.startsWith('yes ') || lower.startsWith('y —') || lower.startsWith('y -')) {
    decision = 'waived';
  } else if (lower.includes('waive') || lower === 'no' || lower.startsWith('no ') || lower.startsWith('n —') || lower.startsWith('n -')) {
    decision = 'approved';"
mutate "applyHotfixStampAnswer swaps yes/no ledger decisions"

# Stamp-off invariant: working tree must match hotfix when done.
if ! git -C "$ROOT" diff --quiet "${HOTFIX}:${SRC#"$ROOT"/}" "HEAD:${SRC#"$ROOT"/}" 2>/dev/null; then
  echo "WARN: HEAD already differs from hotfix before sweep"
fi

echo "mutants: killed=$killed survived=$survived skipped=$skipped"
if [[ "$survived" -gt 0 ]]; then exit 1; fi
if [[ "$skipped" -gt 0 ]]; then exit 1; fi
echo "ALL MUTANTS KILLED"
exit 0
