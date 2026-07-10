/**
 * BL-239: proves the full composition extension.ts wires together -
 * TelegramNarrator's onSendResult feeding TelegramInboundRelay.
 * recordGatePrompt, so a human's Telegram reply to a posted gate-prompt
 * message is relayed as a real gate answer - without vscode, tmux, or any
 * network anywhere in the path. Mirrors
 * stuckEscalationEmailBridge.test.js's "prove the composition, not the
 * glue" convention: extension.ts itself only wires these same calls
 * together, so this is what actually exercises that wiring.
 */
const assert = require('node:assert/strict');
const { TelegramNarrator } = require('../out/notify/telegramNarrator');
const { TelegramInboundRelay } = require('../out/notify/telegramInboundRelay');

const AUTHORIZED_CHAT_ID = '999888777';
const RETRY_CONFIG = { maxAttempts: 3, backoffBaseMs: 10, backoffMaxMs: 40 };

function snapshot(overrides = {}) {
  return { runName: 'swarm-1', prUrl: null, pipeline: [], gates: [], deadLetters: [], ...overrides };
}

function wireComposition() {
  const sentMessages = [];
  const gateAnswers = [];
  let nextMessageId = 1;

  const relay = new TelegramInboundRelay(AUTHORIZED_CHAT_ID, {
    answerGate: (role, answer) => {
      gateAnswers.push({ role, answer });
      return { success: true };
    },
  });

  const narrator = new TelegramNarrator(RETRY_CONFIG, {
    sendOnce: async (text, replyToMessageId) => {
      const messageId = nextMessageId++;
      sentMessages.push({ text, replyToMessageId, messageId });
      return { success: true, messageId };
    },
    onSendResult: (event, result) => {
      // Exactly what extension.ts's live wiring does: a successfully-posted
      // 'gate' narration event becomes a pending gate prompt the relay can
      // later match a reply against.
      if (event.kind === 'gate' && event.role && result.success && result.messageId !== undefined) {
        relay.recordGatePrompt(result.messageId, event.role);
      }
    },
    wait: async () => {},
  });

  return { narrator, relay, sentMessages, gateAnswers };
}

test('BL-239: a gate posted by the narrator can be answered by a Telegram reply, end to end', async () => {
  const { narrator, relay, sentMessages, gateAnswers } = wireComposition();
  const now = Date.parse('2026-07-10T12:00:00Z');

  await narrator.sweep(snapshot({ gates: [{ role: 'coder', gated: false }] }), now);
  await narrator.sweep(
    snapshot({ gates: [{ role: 'coder', gated: true, snippet: 'Allow this action? (y/n)' }] }),
    now + 1000
  );

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /coder needs you/);
  const gateMessageId = sentMessages[0].messageId;

  relay.handleUpdate({
    update_id: 1,
    message: {
      message_id: 500,
      chat: { id: Number(AUTHORIZED_CHAT_ID) },
      text: 'yes',
      reply_to_message: { message_id: gateMessageId },
    },
  });

  assert.deepEqual(gateAnswers, [{ role: 'coder', answer: 'yes' }]);
});

test('BL-239: a reply to a NON-gate narration message (e.g. a stage-transition post) is never relayed as a gate answer', async () => {
  const { narrator, relay, sentMessages, gateAnswers } = wireComposition();
  const now = Date.parse('2026-07-10T12:00:00Z');

  await narrator.sweep(snapshot({ pipeline: [{ role: 'coder', status: 'active' }] }), now);
  await narrator.sweep(snapshot({ pipeline: [{ role: 'coder', status: 'idle' }] }), now + 1000);

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /coder: active -> idle/);
  const stageTransitionMessageId = sentMessages[0].messageId;

  relay.handleUpdate({
    update_id: 1,
    message: {
      message_id: 501,
      chat: { id: Number(AUTHORIZED_CHAT_ID) },
      text: 'ok',
      reply_to_message: { message_id: stageTransitionMessageId },
    },
  });

  assert.deepEqual(gateAnswers, [], 'only a reply to an actual GATE message may ever be relayed as an answer');
});
