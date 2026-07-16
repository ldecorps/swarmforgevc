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

// ── BL-444: group-to-supergroup migration ─────────────────────────────────

// Reconstructs the exact live update queue from the ticket's own E2E
// procedure: ids 143744666-669 in the dead pre-migration group, 143744670-671
// already in the live supergroup, then 143744672 - the migrate_to_chat_id
// notice, posted in the OLD chat, LAST in update_id order.
function migratedUpdateQueue() {
  const DEAD_CHAT_ID = -5274683022;
  const LIVE_CHAT_ID = -1003886489685;
  return [
    { update_id: 143744666, message: { message_id: 1, chat: { id: DEAD_CHAT_ID }, text: 'bot added to the group' } },
    { update_id: 143744667, message: { message_id: 2, chat: { id: DEAD_CHAT_ID }, text: 'group settings changed' } },
    { update_id: 143744668, message: { message_id: 3, chat: { id: DEAD_CHAT_ID }, text: 'Topics enabled' } },
    { update_id: 143744669, message: { message_id: 4, chat: { id: DEAD_CHAT_ID }, text: 'more pre-migration chatter' } },
    { update_id: 143744670, message: { message_id: 5, chat: { id: LIVE_CHAT_ID }, text: 'a message already in the new supergroup' } },
    { update_id: 143744671, message: { message_id: 6, chat: { id: LIVE_CHAT_ID }, text: 'another one' } },
    { update_id: 143744672, message: { message_id: 7, chat: { id: DEAD_CHAT_ID }, migrate_to_chat_id: LIVE_CHAT_ID, text: '' } },
  ];
}

test('BL-444: decideChannelDetection follows a migrate_to_chat_id notice to the live supergroup id, never the dead pre-migration id', () => {
  const result = decideChannelDetection(migratedUpdateQueue());
  assert.deepEqual(result, { ready: true, chatId: '-1003886489685' });
});

test('BL-444: decideChannelDetection follows a migrate_from_chat_id message (posted in the new chat) to that chat\'s own id', () => {
  const updates = [
    { update_id: 1, message: { message_id: 1, chat: { id: -5274683022 }, text: 'pre-migration' } },
    { update_id: 2, message: { message_id: 2, chat: { id: -1003886489685 }, migrate_from_chat_id: -5274683022, text: '' } },
  ];

  assert.deepEqual(decideChannelDetection(updates), { ready: true, chatId: '-1003886489685' });
});

test('BL-444: decideChannelDetection ignores migration fields entirely when no migration ever happened (BL-380 behavior unchanged)', () => {
  const updates = [
    { update_id: 1, message: { message_id: 1, chat: { id: 555666777 }, text: 'Bot was added to the group' } },
  ];

  assert.deepEqual(decideChannelDetection(updates), { ready: true, chatId: '555666777' });
});

// ── provisionTelegramChannel ────────────────────────────────────────────────

function fakeAdapters(overrides = {}) {
  const persistBotTokenCalls = [];
  const persistChannelCalls = [];
  const createNegotiationTopicCalls = [];
  const persistConfirmOffsetCalls = [];
  return {
    calls: { persistBotTokenCalls, persistChannelCalls, createNegotiationTopicCalls, persistConfirmOffsetCalls },
    adapters: {
      getUpdates: async () => ({ success: true, updates: [] }),
      createNegotiationTopic: async (chatId) => {
        createNegotiationTopicCalls.push(chatId);
        return { success: true, messageThreadId: 42 };
      },
      persistChannel: (chatId, negotiationTopicId) => persistChannelCalls.push({ chatId, negotiationTopicId }),
      persistBotToken: () => persistBotTokenCalls.push(1),
      persistConfirmOffset: (offset) => persistConfirmOffsetCalls.push(offset),
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
  const { adapters, calls } = fakeAdapters({ getUpdates: async () => ({ success: true, updates: [] }) });

  const outcome = await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.equal(outcome.ready, false);
  assert.equal(outcome.error, undefined, 'expected no error field for the legitimate not-ready-yet case');
  assert.equal(outcome.chatId, undefined);
  assert.equal(outcome.negotiationTopicId, undefined);
  assert.equal(calls.createNegotiationTopicCalls.length, 0, 'expected no negotiation topic to be opened for a half-finished channel');
});

test('provisionTelegramChannel still persists the bot token even when the channel is not ready yet', async () => {
  const { adapters, calls } = fakeAdapters({ getUpdates: async () => ({ success: true, updates: [] }) });

  await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.equal(calls.persistBotTokenCalls.length, 1);
});

// BL-380 QA bounce (backlog/evidence/BL-380-...-bounce-20260715.md): a
// getUpdates FETCH FAILURE (bad token, network error, rate limit) was
// silently collapsed into the exact same {ready:false} result as the
// legitimate "human hasn't finished creating the group yet" case above -
// indistinguishable to whoever is running onboarding. Mirrors how
// createNegotiationTopic's own failure is already surfaced below.
test('provisionTelegramChannel reports a getUpdates fetch failure as an error, distinguishable from not-ready-yet, and never opens a topic', async () => {
  const { adapters, calls } = fakeAdapters({
    getUpdates: async () => ({ success: false, updates: [], error: 'Unauthorized' }),
  });

  const outcome = await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.equal(outcome.ready, false);
  assert.match(outcome.error, /Unauthorized/);
  assert.equal(calls.createNegotiationTopicCalls.length, 0, 'expected no negotiation topic to be opened when the update fetch itself failed');
});

test('provisionTelegramChannel falls back to a generic error when a getUpdates failure carries no error string', async () => {
  const { adapters } = fakeAdapters({
    getUpdates: async () => ({ success: false, updates: [] }),
  });

  const outcome = await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.equal(outcome.ready, false);
  assert.equal(outcome.error, 'failed to fetch updates');
});

test('provisionTelegramChannel still persists the bot token even when the getUpdates fetch fails', async () => {
  const { adapters, calls } = fakeAdapters({
    getUpdates: async () => ({ success: false, updates: [], error: 'Unauthorized' }),
  });

  await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.equal(calls.persistBotTokenCalls.length, 1);
});

test('provisionTelegramChannel opens the negotiation topic in the detected chat and persists the channel once ready', async () => {
  const detectedUpdates = [{ update_id: 1, message: { message_id: 1, chat: { id: 555666777 }, text: 'added' } }];
  const { adapters, calls } = fakeAdapters({ getUpdates: async () => ({ success: true, updates: detectedUpdates }) });

  const outcome = await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.equal(outcome.ready, true);
  assert.equal(outcome.chatId, '555666777');
  assert.equal(outcome.negotiationTopicId, 42);
  assert.deepEqual(calls.createNegotiationTopicCalls, ['555666777']);
  assert.deepEqual(calls.persistChannelCalls, [{ chatId: '555666777', negotiationTopicId: 42 }]);
});

// BL-444 provisioning-follows-supergroup-migration-03: the confirm offset
// only advances once provisioning has FULLY succeeded.
test('BL-444: provisionTelegramChannel confirms the offset past every consumed update once the negotiation topic actually opens', async () => {
  const detectedUpdates = [
    { update_id: 10, message: { message_id: 1, chat: { id: 555666777 }, text: 'added' } },
    { update_id: 11, message: { message_id: 2, chat: { id: 555666777 }, text: 'later' } },
  ];
  const { adapters, calls } = fakeAdapters({ getUpdates: async () => ({ success: true, updates: detectedUpdates }) });

  await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.deepEqual(calls.persistConfirmOffsetCalls, [12], 'expected the offset to advance past the highest update_id seen (11 + 1)');
});

test('BL-444: provisionTelegramChannel never confirms the offset when the negotiation topic fails to open', async () => {
  const detectedUpdates = [{ update_id: 1, message: { message_id: 1, chat: { id: 555666777 }, text: 'added' } }];
  const { adapters, calls } = fakeAdapters({
    getUpdates: async () => ({ success: true, updates: detectedUpdates }),
    createNegotiationTopic: async () => ({ success: false, error: 'boom' }),
  });

  await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.deepEqual(calls.persistConfirmOffsetCalls, []);
});

test('BL-444: provisionTelegramChannel never confirms the offset when not ready', async () => {
  const { adapters, calls } = fakeAdapters({ getUpdates: async () => ({ success: true, updates: [] }) });

  await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.deepEqual(calls.persistConfirmOffsetCalls, []);
});

// BL-444 provisioning-follows-supergroup-migration-02: "group chat was
// upgraded to a supergroup chat" is a REDIRECT to retry against, not a
// terminal failure.
test('BL-444: provisionTelegramChannel retries createNegotiationTopic against the migrated id when it reports migrateToChatId', async () => {
  const detectedUpdates = [{ update_id: 1, message: { message_id: 1, chat: { id: 555666777 }, text: 'added' } }];
  const attemptedChatIds = [];
  const { adapters, calls } = fakeAdapters({
    getUpdates: async () => ({ success: true, updates: detectedUpdates }),
    createNegotiationTopic: async (chatId) => {
      attemptedChatIds.push(chatId);
      if (chatId === '555666777') {
        return { success: false, error: 'Telegram API responded with status 400: group chat was upgraded to a supergroup chat', migrateToChatId: '999888777' };
      }
      return { success: true, messageThreadId: 77 };
    },
  });

  const outcome = await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.equal(outcome.ready, true);
  assert.equal(outcome.chatId, '999888777', 'expected the redirected id to be the one reported, not the original dead one');
  assert.equal(outcome.negotiationTopicId, 77);
  assert.equal(outcome.error, undefined);
  assert.deepEqual(attemptedChatIds, ['555666777', '999888777'], 'expected exactly one retry, against the redirected id');
  assert.deepEqual(calls.persistChannelCalls, [{ chatId: '999888777', negotiationTopicId: 77 }]);
});

test('BL-444: provisionTelegramChannel reports a real failure when the retry against the migrated id also fails', async () => {
  const detectedUpdates = [{ update_id: 1, message: { message_id: 1, chat: { id: 555666777 }, text: 'added' } }];
  const { adapters } = fakeAdapters({
    getUpdates: async () => ({ success: true, updates: detectedUpdates }),
    createNegotiationTopic: async () => ({
      success: false,
      error: 'Telegram API responded with status 400: group chat was upgraded to a supergroup chat',
      migrateToChatId: '999888777',
    }),
  });

  const outcome = await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.equal(outcome.ready, true);
  assert.equal(outcome.chatId, '999888777');
  assert.equal(outcome.negotiationTopicId, undefined);
  assert.ok(outcome.error, 'expected an error to be reported when the retry against the migrated id also fails');
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
    getUpdates: async () => ({ success: true, updates: detectedUpdates }),
    createNegotiationTopic: async () => ({ success: false, error: 'Telegram API responded with status 400' }),
  });

  const outcome = await provisionTelegramChannel('sfvc_target_bot', adapters);

  assert.equal(outcome.ready, true);
  assert.equal(outcome.chatId, '555666777');
  assert.equal(outcome.negotiationTopicId, undefined);
  assert.match(outcome.error, /400/);
  assert.equal(calls.persistChannelCalls.length, 0, 'expected no partial channel record when the topic never actually opened');
});
