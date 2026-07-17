#!/usr/bin/env node
/**
 * BL-423: auto-resumes an expired TIMED pause and announces it to the
 * Control topic - the headless daemon-side half of the pause/resume
 * feature. handoffd.bb's own sweep cadence (chase_sweep_lib.bb's cadence,
 * per this ticket's own "ride the daemon's existing sweep cadence"
 * instruction) shells to this compiled CLI every cycle, same posture as
 * notify-dead-letters.ts/notify-recert-batch.ts.
 *
 * decidePauseAutoResume (telegramControlCore.ts, pure/injected-clock) owns
 * the ONLY decision here: an "until I resume" pause (no untilMs) never
 * auto-expires - only an explicit Resume-now tap (telegram-front-desk-bot.ts's
 * own resumeNow) clears that one. A timed pause past its own untilMs is
 * cleared here AND announced - both the front-desk bot's own writer
 * (applyPause/resumeNow, for an explicit human action) and this sweep's
 * writer (only ever clearing an ALREADY-expired marker) converge on the
 * same {active:false}, never a conflicting write.
 *
 * Usage: node resume-expired-pauses.js
 *
 * Runnable from the repo root or any .worktrees/<role>/ checkout, same
 * project-root resolution as notify-dead-letters.ts. Headless: reads
 * TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID from the process environment.
 */
import { decidePauseAutoResume } from './telegramControlCore';
import { readControlPauseState, writeControlPauseState, postControlMessage, readTopicMap } from './telegram-front-desk-bot';
import { topicForSubject, CONTROL_SUBJECT_ID } from './telegramFrontDeskBotCore';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain } from './swarm-metrics';
import { TelegramPostFn } from '../notify/telegramClient';

// BL-423 E2E test seam, mirroring notify-dead-letters.ts's own
// TELEGRAM_NOTIFY_FORCE_RESULT convention exactly - no real network call
// ever happens under it.
function forcedPostFn(): TelegramPostFn | undefined {
  const forced = process.env.TELEGRAM_NOTIFY_FORCE_RESULT;
  if (!forced) {
    return undefined;
  }
  const { success } = JSON.parse(forced) as { success: boolean };
  return async () => ({ ok: success, status: success ? 200 : 500, json: { ok: success, result: { message_id: 1 } } });
}

export async function main(): Promise<void> {
  const { projectRoot } = resolveCliMainWorktreeContext();
  const pauseState = readControlPauseState(projectRoot);
  const decision = decidePauseAutoResume(pauseState, Date.now());

  if (decision !== 'auto-resume') {
    printJsonToStdout({ resumed: false, reason: 'not-due' });
    return;
  }

  // Cleared FIRST, unconditionally - a missing/unreachable Telegram config
  // must never leave the swarm permanently frozen on a marker that has
  // already, definitionally, expired.
  writeControlPauseState(projectRoot, { active: false });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    printJsonToStdout({ resumed: true, announced: false, reason: 'missing-telegram-config' });
    return;
  }

  const controlTopicId = topicForSubject(readTopicMap(projectRoot), CONTROL_SUBJECT_ID);
  await postControlMessage(token, chatId, controlTopicId, 'Resumed - the pause duration elapsed. New work will be promoted again.', undefined, forcedPostFn());
  printJsonToStdout({ resumed: true, announced: controlTopicId !== undefined });
}

if (require.main === module) {
  runCliMain(main);
}
