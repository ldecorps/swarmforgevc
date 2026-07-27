#!/usr/bin/env node
/**
 * Telegram ↔ Cursor SDK remote control for the local repo.
 *
 * Usage: node telegram-cursor-bridge.js <repo-root>
 */
import * as path from 'path';
import { createLiveCursorBridgeAgentSession } from '../bridge/cursorBridgeAgentSession';
import {
  bootstrapCursorBridgeState,
  handleInboundDecision,
  postChunks,
  requiredEnv,
  runCursorBridgePollOnce,
  STATE_FILE_NAME,
  TOPIC_MAP_FILE_NAME,
  writeJsonFile,
  type CursorBridgeLoopDeps,
} from './telegramCursorBridgeLive';

export async function main(): Promise<void> {
  const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
  const opDir = path.join(repoRoot, '.swarmforge', 'operator');
  const statePath = path.join(opDir, STATE_FILE_NAME);
  const topicMapPath = path.join(opDir, TOPIC_MAP_FILE_NAME);

  const botToken = requiredEnv('TELEGRAM_BOT_TOKEN');
  const chatId = requiredEnv('TELEGRAM_CHAT_ID');
  const principalUserId = requiredEnv('TELEGRAM_PRINCIPAL_USER_ID');

  const agentSession = createLiveCursorBridgeAgentSession(repoRoot);
  let state = await bootstrapCursorBridgeState(repoRoot, botToken, chatId, statePath, topicMapPath);

  let busy = false;
  let pollFailures = 0;

  const bootPrompt = process.env.CURSOR_BRIDGE_BOOT_PROMPT?.trim();
  if (bootPrompt && state.cursorTopicId !== undefined) {
    const persistState = () => writeJsonFile(statePath, state);
    const syncAgentIdFromSession = () => {
      state = { ...state, agentId: agentSession.readAgentId() };
    };
    const resetAgent = async () => {
      await agentSession.resetSession();
      syncAgentIdFromSession();
      persistState();
    };
    await postChunks(botToken, chatId, state.cursorTopicId, `Boot test prompt: ${bootPrompt}`);
    busy = await handleInboundDecision(
      { action: 'prompt', text: bootPrompt },
      {
        botToken,
        chatId,
        state,
        busy,
        agentSession,
        opDir,
        post: postChunks,
        persistState,
        syncAgentIdFromSession,
      },
      undefined,
      resetAgent
    );
  }

  const loopDeps: CursorBridgeLoopDeps = {
    botToken,
    chatId,
    principalUserId,
    opDir,
    statePath,
    topicMapPath,
    agentSession,
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const next = await runCursorBridgePollOnce(loopDeps, state, busy, pollFailures);
    state = next.state;
    busy = next.busy;
    pollFailures = next.pollFailures;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
