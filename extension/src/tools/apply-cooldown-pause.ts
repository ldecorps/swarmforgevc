#!/usr/bin/env node
/**
 * BL-617: applies the nightly cooldown window's timed pause when the
 * configured window opens - the SCHEDULER half; resume-expired-pauses.js
 * already owns the morning thaw (BL-423, unchanged). handoffd.bb's cooldown
 * sweep shells to this compiled CLI on its existing sweep cadence, same
 * posture as resume-expired-pauses.ts.
 *
 * decideCooldownWindow (cooldownWindowCore.ts, pure/injected-clock) owns the
 * ONLY decision here: at most one automatic pause per window instance, never
 * overriding an already-active pause (human or otherwise). The pause WRITE
 * reuses writeControlPauseState - never a second writer implementation.
 *
 * Usage: node apply-cooldown-pause.js [--now <epoch-ms>] [--dry-run]
 *   --now <epoch-ms>  Injected clock for e2e verification without waiting for
 *                     the real window to open - an argument seam, not a
 *                     *_FORCE_RESULT env bypass. Defaults to Date.now().
 *   --dry-run         Prints the decision without writing pause state, the
 *                     marker, or posting any announcement.
 *
 * Runnable from the repo root or any .worktrees/<role>/ checkout, same
 * project-root resolution as resume-expired-pauses.ts. Headless: reads
 * TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID from the process environment.
 */
import { decideCooldownWindow } from './cooldownWindowCore';
import { readCooldownConfigFromDisk, readCooldownWindowMarker, writeCooldownWindowMarker } from './cooldownWindowState';
import { readControlPauseState, writeControlPauseState, postControlMessage, readTopicMap } from './telegram-front-desk-bot';
import { topicForSubject, CONTROL_SUBJECT_ID } from './telegramFrontDeskBotCore';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain } from './swarm-metrics';
import { TelegramPostFn } from '../notify/telegramClient';

// BL-617 E2E test seam, mirroring resume-expired-pauses.ts's own
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

export function parseArgs(argv: string[]): { nowMs: number; dryRun: boolean } {
  let nowMs = Date.now();
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--now' && argv[i + 1] !== undefined) {
      nowMs = Number(argv[i + 1]);
      i++;
    } else if (argv[i] === '--dry-run') {
      dryRun = true;
    }
  }
  return { nowMs, dryRun };
}

export async function main(): Promise<void> {
  const { projectRoot } = resolveCliMainWorktreeContext();
  const { nowMs, dryRun } = parseArgs(process.argv.slice(2));

  const { config, malformed, warning } = readCooldownConfigFromDisk(projectRoot);
  if (malformed) {
    process.stderr.write(`cooldown config malformed: ${warning}\n`);
  }

  const pauseState = readControlPauseState(projectRoot);
  const { lastHandledWindowStartMs } = readCooldownWindowMarker(projectRoot);
  const decision = decideCooldownWindow({ nowMs, config, pauseState, lastHandledWindowStartMs });

  if (decision.action !== 'apply-pause') {
    printJsonToStdout({ decision: decision.action, ...(warning ? { warning } : {}) });
    return;
  }

  if (dryRun) {
    printJsonToStdout({ decision: 'apply-pause', untilMs: decision.untilMs, dryRun: true });
    return;
  }

  writeControlPauseState(projectRoot, { active: true, untilMs: decision.untilMs });
  writeCooldownWindowMarker(projectRoot, decision.windowStartMs);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    printJsonToStdout({ decision: 'apply-pause', untilMs: decision.untilMs, announced: false, reason: 'missing-telegram-config' });
    return;
  }

  const controlTopicId = topicForSubject(readTopicMap(projectRoot), CONTROL_SUBJECT_ID);
  const resumeLabel = new Date(decision.untilMs).toISOString();
  await postControlMessage(
    token,
    chatId,
    controlTopicId,
    `Nightly cooldown - paused until ${resumeLabel} (local window close). In-flight work continues.`,
    undefined,
    forcedPostFn()
  );
  printJsonToStdout({ decision: 'apply-pause', untilMs: decision.untilMs, announced: controlTopicId !== undefined });
}

if (require.main === module) {
  runCliMain(main);
}
