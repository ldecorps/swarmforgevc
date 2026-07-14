const assert = require('node:assert/strict');
const {
  buildAddToGroupLink,
  buildChannelProvisioningInstructions,
  decideChannelDetection,
  provisionTelegramChannel,
  NEGOTIATION_TOPIC_NAME,
} = require('../out/onboarding/telegramChannelProvisioning');

// ── buildAddToGroupLink / buildChannelProvisioningInstructions ────────────

test('buildAddToGroupLink builds a startgroup deep link for the given bot username', () => {
  assert.equal(buildAddToGroupLink('sfvc_target_bot'), 'https://t.me/sfvc_target_bot?startgroup=true');
});

test('buildChannelProvisioningInstructions gives steps covering the whole manual sequence and a matching deep link', () => {
  const instructions = buildChannelProvisioningInstructions('sfvc_target_bot');

  assert.equal(instructions.addToGroupLink, 'https://t.me/sfvc_target_bot?startgroup=true');
  assert.ok(instructions.steps.some((step) => /BotFather/.test(step)), `expected a BotFather step, got: ${JSON.stringify(instructions.steps)}`);
  assert.ok(instructions.steps.some((step) => /group/i.test(step)), `expected a group-creation step, got: ${JSON.stringify(instructions.steps)}`);
  assert.ok(instructions.steps.some((step) => /Topics/.test(step)), `expected a Topics step, got: ${JSON.stringify(instructions.steps)}`);
  assert.ok(
    instructions.steps.some((step) => step.includes(instructions.addToGroupLink)),
    `expected the deep link to appear in the steps, got: ${JSON.stringify(instructions.steps)}`
  );
});

// ── decideChannelDetection ─────────────────────────────────────────────────

test('decideChannelDetection reports not ready when no update carries a chat', () => {
  assert.deepEqual(decideChannelDetection([]), { ready: false });
});

test('decideChannelDetection reports not ready for updates with no message (e.g. an edited_message-only update)', () => {
  assert.deepEqual(decideChannelDetection([{ update_id: 1 }]), { ready: false });
});

test('decideChannelDetection reads the chat id off the FIRST update that carries one, never asking the human for it', () => {
  const updates = [
    { update_id: 1, message: { message_id: 1, chat: { id: 555666777 }, text: 'Bot was added to the group' } },
    { update_id: 2, message: { message_id: 2, chat: { id: 999999999 }, text: 'a later, unrelated update' } },
  ];

  assert.deepEqual(decideChannelDetection(updates), { ready: true, chatId: '555666777' });
});

// ── provisionTelegramChannel ────────────────────────────────────────────────

function fakeAdapters(overrides = {}) {
  const persistBotTokenCalls = [];
  const persistChannelCalls = [];
  const createNegotiationTopicCalls = [];
  return {
    calls: { persistBotTokenCalls, persistChannelCalls, createNegotiationTopicCalls },
    adapters: {
      getUpdates: async () => [],
      createNegotiationTopic: async (chatId) => {
        createNegotiationTopicCalls.push(chatId);
        return { success: true, messageThreadId: 42 };
      },
      persistChannel: (chatId, negotiationTopicId) => persistChannelCalls.push({ chatId, negotiationTopicId }),
      persistBotToken: () => persistBotTokenCalls.push(1),
      ...overrides,
    },
  };
}

test('provisionTelegramChannel always returns the provisioning instructions', async () => {
  const { adapters } = fakeAdapters();

  const outcome = await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.equal(outcome.instructions.addToGroupLink, 'https://t.me/sfvc_target_bot?startgroup=true');
});

test('provisionTelegramChannel reports not ready and never opens a topic when the group has not been detected yet', async () => {
  const { adapters, calls } = fakeAdapters({ getUpdates: async () => [] });

  const outcome = await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.equal(outcome.ready, false);
  assert.equal(outcome.chatId, undefined);
  assert.equal(outcome.negotiationTopicId, undefined);
  assert.equal(calls.createNegotiationTopicCalls.length, 0, 'expected no negotiation topic to be opened for a half-finished channel');
});

test('provisionTelegramChannel still persists the bot token even when the channel is not ready yet', async () => {
  const { adapters, calls } = fakeAdapters({ getUpdates: async () => [] });

  await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.equal(calls.persistBotTokenCalls.length, 1);
});

test('provisionTelegramChannel opens the negotiation topic in the detected chat and persists the channel once ready', async () => {
  const detectedUpdates = [{ update_id: 1, message: { message_id: 1, chat: { id: 555666777 }, text: 'added' } }];
  const { adapters, calls } = fakeAdapters({ getUpdates: async () => detectedUpdates });

  const outcome = await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.equal(outcome.ready, true);
  assert.equal(outcome.chatId, '555666777');
  assert.equal(outcome.negotiationTopicId, 42);
  assert.deepEqual(calls.createNegotiationTopicCalls, ['555666777']);
  assert.deepEqual(calls.persistChannelCalls, [{ chatId: '555666777', negotiationTopicId: 42 }]);
});

test('provisionTelegramChannel names the negotiation topic using the shared NEGOTIATION_TOPIC_NAME constant (proven via the CLI adapter contract)', () => {
  // The topic NAME itself is passed by the CLI wiring (createForumTopic's own
  // argument), not by this pure module - this test only pins the exported
  // constant's value so a future rename is deliberate, not accidental.
  assert.equal(NEGOTIATION_TOPIC_NAME, 'Contract negotiation');
});

test('provisionTelegramChannel reports the failure and withholds negotiationTopicId when opening the topic fails, without persisting a partial channel', async () => {
  const detectedUpdates = [{ update_id: 1, message: { message_id: 1, chat: { id: 555666777 }, text: 'added' } }];
  const { adapters, calls } = fakeAdapters({
    getUpdates: async () => detectedUpdates,
    createNegotiationTopic: async () => ({ success: false, error: 'Telegram API responded with status 400' }),
  });

  const outcome = await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.equal(outcome.ready, true);
  assert.equal(outcome.chatId, '555666777');
  assert.equal(outcome.negotiationTopicId, undefined);
  assert.match(outcome.error, /400/);
  assert.equal(calls.persistChannelCalls.length, 0, 'expected no partial channel record when the topic never actually opened');
});
