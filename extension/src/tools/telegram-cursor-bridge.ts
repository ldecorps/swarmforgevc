#!/usr/bin/env node
/**
 * Telegram ↔ Cursor SDK remote control for the local repo.
 *
 * Usage: node telegram-cursor-bridge.js <repo-root>
 */
import * as path from 'path';
import { createLiveCursorBridgeAgentSession } from '../bridge/cursorBridgeAgentSession';
import {
  CURSOR_BRIDGE_CLI_USAGE,
  parseCursorBridgeCliArgs,
} from './telegramCursorBridgeCore';
import { requiredEnv, runCursorBridgeApp } from './telegramCursorBridgeLive';

export async function main(): Promise<void> {
  const parsed = parseCursorBridgeCliArgs(process.argv.slice(2));
  if (parsed.kind === 'help') {
    console.log(CURSOR_BRIDGE_CLI_USAGE);
    return;
  }
  const repoRoot = path.resolve(parsed.repoRootArg ?? process.cwd());
  await runCursorBridgeApp(
    {
      repoRoot,
      botToken: requiredEnv('TELEGRAM_BOT_TOKEN'),
      chatId: requiredEnv('TELEGRAM_CHAT_ID'),
      principalUserId: requiredEnv('TELEGRAM_PRINCIPAL_USER_ID'),
      bootPrompt: process.env.CURSOR_BRIDGE_BOOT_PROMPT?.trim() || undefined,
    },
    createLiveCursorBridgeAgentSession(repoRoot)
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
