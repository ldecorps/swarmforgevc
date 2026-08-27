#!/usr/bin/env bash
# BL-726 hardener: surgical mutation over BL-718 + BL-726 acceptance step handlers.
# Soft Gherkin already kills Outline scenario-name cells (5/5); this hand-authored
# sweep covers the non-Outline load-bearing asserts (BL-638 posture for wiring).
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

BL726=specs/pipeline/steps/bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps.js
BL718=specs/pipeline/steps/bl718BubbleTalkMirrorSteps.js
ACC726=(bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-726-bl718-acceptance-feature-has-no-step-handlers.feature)
ACC718=(bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-718-bubble-talk-mirror-chunks-and-fails-loudly.feature)

BACKUP_ROOT="$(mktemp -d)"
cp "$BL726" "$BACKUP_ROOT/bl726.js"
cp "$BL718" "$BACKUP_ROOT/bl718.js"
restore() {
  cp "$BACKUP_ROOT/bl726.js" "$BL726"
  cp "$BACKUP_ROOT/bl718.js" "$BL718"
}
cleanup() { restore; rm -rf "$BACKUP_ROOT" /tmp/bl726_from.txt /tmp/bl726_to.txt /tmp/bl726_target.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! "${ACC726[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${ACC718[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate_file() {
  local label="$1" target="$2"
  restore
  printf '%s' "$target" > /tmp/bl726_target.txt
  if ! python3 - <<'PY'
from pathlib import Path
target = Path('/tmp/bl726_target.txt').read_text().strip()
a = Path('/tmp/bl726_from.txt').read_text()
b = Path('/tmp/bl726_to.txt').read_text()
s = Path(target).read_text()
if a not in s:
    raise SystemExit(3)
Path(target).write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  python3 -c 'import pathlib,sys; pathlib.Path("/tmp/bl726_from.txt").write_text(sys.argv[1]); pathlib.Path("/tmp/bl726_to.txt").write_text(sys.argv[2])' "$1" "$2"
}

echo "mutation sweep over BL-718/BL-726 acceptance step handlers (BL-726)"

# --- bl726 meta handlers ---

write_pair \
  'if (ctx.bl726Cli?.status !== 0) {
      throw new Error(`BL-718 CLI exited ${ctx.bl726Cli.status}:\n${out}`);
    }' \
  'if (ctx.bl726Cli?.status === 0) {
      throw new Error(`BL-718 CLI exited ${ctx.bl726Cli.status}:\n${out}`);
    }'
mutate_file "bl726: exit-0 success check inverted" "$BL726"

write_pair \
  "if (!indexSource.includes(\"require('./bl718BubbleTalkMirrorSteps')\")) {
      throw new Error('specs/pipeline/steps/index.js must require bl718BubbleTalkMirrorSteps');
    }" \
  "if (!indexSource.includes(\"require('./bl718BubbleTalkMirrorStepsMISSING')\")) {
      throw new Error('specs/pipeline/steps/index.js must require bl718BubbleTalkMirrorSteps');
    }"
mutate_file "bl726: index require pin always misses" "$BL726"

write_pair \
  'if (!/mirrorLetsTalkTurnToBubble/.test(src) || !/splitTelegramChunks/.test(src)) {
        throw new Error('\''BL-718 handler must require mirrorLetsTalkTurnToBubble and splitTelegramChunks'\'');
      }' \
  'if (!/mirrorLetsTalkTurnToBubbleX/.test(src) || !/splitTelegramChunks/.test(src)) {
        throw new Error('\''BL-718 handler must require mirrorLetsTalkTurnToBubble and splitTelegramChunks'\'');
      }'
mutate_file "bl726: mirror symbol pin corrupted" "$BL726"

write_pair \
  'if (/swarmforge\/roles\/.*\.prompt/.test(src)) {
      throw new Error('\''BL-718 handler must not assert against role prompt files'\'');
    }' \
  'if (!/swarmforge\/roles\/.*\.prompt/.test(src)) {
      throw new Error('\''BL-718 handler must not assert against role prompt files'\'');
    }'
mutate_file "bl726: prompt-text ban polarity inverted" "$BL726"

write_pair \
  'if (ctx.bl726Cli?.status !== 0) {
      throw new Error(`expected CLI exit 0, got ${ctx.bl726Cli.status}:\n${ctx.bl726Cli.output}`);
    }' \
  'if (ctx.bl726Cli?.status === 0) {
      throw new Error(`expected CLI exit 0, got ${ctx.bl726Cli.status}:\n${ctx.bl726Cli.output}`);
    }'
mutate_file "bl726: full-feature exit-0 check inverted" "$BL726"

# --- bl718 product handlers ---

write_pair \
  'if (!ctx.sent.every((s) => s.topicId === BUBBLE_TOPIC_ID)) {
    throw new Error(`expected Bubble topic ${BUBBLE_TOPIC_ID}, got: ${JSON.stringify(ctx.sent)}`);
  }' \
  'if (!ctx.sent.every((s) => s.topicId === CURSOR_TOPIC_ID)) {
    throw new Error(`expected Bubble topic ${BUBBLE_TOPIC_ID}, got: ${JSON.stringify(ctx.sent)}`);
  }'
mutate_file "bl718: Bubble topic assert uses Cursor id" "$BL718"

write_pair \
  'if (ctx.sent.some((s) => s.topicId === CURSOR_TOPIC_ID)) {
    throw new Error('\''Cursor Remote topic must not receive the ordinary talk dump'\'');
  }' \
  'if (ctx.sent.some((s) => s.topicId === BUBBLE_TOPIC_ID)) {
    throw new Error('\''Cursor Remote topic must not receive the ordinary talk dump'\'');
  }'
mutate_file "bl718: cursor-ban fires on Bubble topic" "$BL718"

write_pair \
  'if (ctx.splitCalls.length !== 1) {
        throw new Error(`expected one splitTelegramChunks call, got ${ctx.splitCalls.length}`);
      }' \
  'if (ctx.splitCalls.length === 1) {
        throw new Error(`expected one splitTelegramChunks call, got ${ctx.splitCalls.length}`);
      }'
mutate_file "bl718: splitCalls length polarity inverted" "$BL718"

write_pair \
  "if (events.length === 0) {
      throw new Error('expected bubble-talk-mirror-failed operator event');
    }" \
  "if (events.length !== 0) {
      throw new Error('expected bubble-talk-mirror-failed operator event');
    }"
mutate_file "bl718: failure-event empty check inverted" "$BL718"

write_pair \
  "if (!ctx.turnResult?.success || ctx.turnResult.replyText !== 'spoken answer') {
      throw new Error(\`expected successful phone turn, got: \${JSON.stringify(ctx.turnResult)}\`);
    }" \
  "if (ctx.turnResult?.success || ctx.turnResult.replyText !== 'spoken answer') {
      throw new Error(\`expected successful phone turn, got: \${JSON.stringify(ctx.turnResult)}\`);
    }"
mutate_file "bl718: phone-turn success polarity inverted" "$BL718"

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
[[ "$skipped" -eq 0 ]] || exit 1
echo "ALL MUTANTS KILLED"
exit 0
