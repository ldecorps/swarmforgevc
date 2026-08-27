#!/usr/bin/env bash
# BL-710 hardener: surgical mutation over frontdesk/all redeploy paths.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
FRONT_DESK=extension/src/tools/telegramCursorBridgeFrontDeskRedeploy.ts
ALL=extension/src/tools/telegramCursorBridgeAllRedeploy.ts
CORE=extension/src/tools/telegramCursorBridgeCore.ts
EXEC=extension/src/tools/telegramCursorOperatorExec.ts
BACKUP_FD=$(mktemp)
BACKUP_ALL=$(mktemp)
BACKUP_CORE=$(mktemp)
BACKUP_EXEC=$(mktemp)
cp "$FRONT_DESK" "$BACKUP_FD"
cp "$ALL" "$BACKUP_ALL"
cp "$CORE" "$BACKUP_CORE"
cp "$EXEC" "$BACKUP_EXEC"
restore() {
  cp "$BACKUP_FD" "$FRONT_DESK"
  cp "$BACKUP_ALL" "$ALL"
  cp "$BACKUP_CORE" "$CORE"
  cp "$BACKUP_EXEC" "$EXEC"
  (cd extension && npm run compile >/dev/null 2>&1) || true
}
cleanup() {
  restore
  rm -f "$BACKUP_FD" "$BACKUP_ALL" "$BACKUP_CORE" "$BACKUP_EXEC" /tmp/bl710_from.txt /tmp/bl710_to.txt
}
trap cleanup EXIT
killed=0
survived=0
skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run test/telegramCursorBridgeRedeployTargets.test.js >/dev/null 2>&1); then return 0; fi
  if ! bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-710-one-clear-telegram-redeploy-path.feature >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate_file() {
  local file="$1"
  local label="$2"
  restore
  if ! python3 - "$file" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
a = Path('/tmp/bl710_from.txt').read_text()
b = Path('/tmp/bl710_to.txt').read_text()
s = p.read_text()
if a not in s:
    raise SystemExit(3)
p.write_text(s.replace(a, b, 1))
PY
  then
    echo "  skip     $label"
    skipped=$((skipped + 1))
    return
  fi
  if suite_fails; then
    echo "  killed   $label"
    killed=$((killed + 1))
    return
  fi
  echo "  SURVIVED $label"
  survived=$((survived + 1))
}

wp() {
  python3 -c 'import pathlib,sys; pathlib.Path("/tmp/bl710_from.txt").write_text(sys.argv[1]); pathlib.Path("/tmp/bl710_to.txt").write_text(sys.argv[2])' "$1" "$2"
}

echo "mutation sweep over BL-710 Telegram redeploy paths"

wp 'return /^\/redeploy(?:[\s_-]+front(?:[\s_-]*desk)?)\s*$/i.test(text.trim());' \
  'return true;'
mutate_file "$FRONT_DESK" "parseFrontDeskRedeployCommand accepts every command"

wp 'return /^\/redeploy(?:[\s_-]+all)\s*$/i.test(text.trim());' \
  'return false;'
mutate_file "$ALL" "parseAllRedeployCommand rejects /redeploy all"

wp "'🔄 Front desk redeploy started (pid ' +" \
  "'🔄 Cursor bridge redeploy started (pid ' +"
mutate_file "$FRONT_DESK" "formatFrontDeskRedeployStartMessage mislabels target runtime"

wp '      `${result.pid}): compile → cursor bridge, front desk, mini app bridge (port ${result.port}).`,' \
  '      `${result.pid}): compile → cursor bridge only (port ${result.port}).`,'
mutate_file "$ALL" "formatAllRedeployStartMessage omits front desk and mini app"

wp "    if (argsLower.includes('all')) {
      const result = startAllRedeployRun(repoRoot);
      const text = result.ok ? formatAllRedeployStartMessage(result) : formatAllRedeployFailureMessage(result);
      return { text, wroteBounceSentinel: false };
    }" \
  "    if (false) {
      const result = startAllRedeployRun(repoRoot);
      const text = result.ok ? formatAllRedeployStartMessage(result) : formatAllRedeployFailureMessage(result);
      return { text, wroteBounceSentinel: false };
    }"
mutate_file "$EXEC" "executeOperatorVerb drops /redeploy all spawn path"

wp "    if (argsLower.includes('front')) {
      const result = startFrontDeskRedeployRun(repoRoot);
      const text = result.ok
        ? formatFrontDeskRedeployStartMessage(result)
        : formatFrontDeskRedeployFailureMessage(result);
      return { text, wroteBounceSentinel: false };
    }" \
  "    if (false) {
      const result = startFrontDeskRedeployRun(repoRoot);
      const text = result.ok
        ? formatFrontDeskRedeployStartMessage(result)
        : formatFrontDeskRedeployFailureMessage(result);
      return { text, wroteBounceSentinel: false };
    }"
mutate_file "$EXEC" "executeOperatorVerb drops /redeploy frontdesk spawn path"

wp "    '/redeploy frontdesk — soft confirm, then bounce the front desk (bridge + bot)'," \
  "    '/redeploy frontdesk — soft confirm, then bounce the cursor bridge only',"
mutate_file "$CORE" "help text mis-describes frontdesk redeploy target"

wp '  const existing = readFrontDeskRedeployLock(repoRoot);
  if (existing) {
    return {
      ok: false,
      reason: '\''already-running'\'',
      detail: `pid ${existing.pid}`,
    };
  }' \
  '  const existing = undefined;
  if (existing) {
    return {
      ok: false,
      reason: '\''already-running'\'',
      detail: `pid ${existing.pid}`,
    };
  }'
mutate_file "$FRONT_DESK" "startFrontDeskRedeployRun ignores running lock"

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 && "$skipped" -eq 0 && "$killed" -eq 8 ]]
