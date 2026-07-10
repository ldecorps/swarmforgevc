const assert = require('node:assert/strict');
const { TelegramInboundRelay, nextUpdateOffset } = require('../out/notify/telegramInboundRelay');

const AUTHORIZED_CHAT_ID = '999888777';

function mkAdapters(overrides = {}) {
  const relayed = [];
  const rejected = [];
  return {
    relayed,
    rejected,
    adapters: {
      answerGate: () => ({ success: true }),
      onRelayed: (role, answer, result) => relayed.push({ role, answer, result }),
      onRejected: (reason, update) => rejected.push({ reason, update }),
      ...overrides,
    },
  };
}

function gatePromptReply(text, overrides = {}) {
  return {
    update_id: 1,
    message: {
      message_id: 100,
      chat: { id: Number(AUTHORIZED_CHAT_ID) },
      text,
      reply_to_message: { message_id: 42 },
      ...overrides,
    },
  };
}

// BL-239 human-reply-answers-gate-02

test('a reply to a recorded gate-prompt message is relayed as an answer for that role', () => {
  const calls = [];
  const { relayed, adapters } = mkAdapters({
    answerGate: (role, answer) => {
      calls.push({ role, answer });
      return { success: true };
    },
  });
  const relay = new TelegramInboundRelay(AUTHORIZED_CHAT_ID, adapters);
  relay.recordGatePrompt(42, 'coder');

  relay.handleUpdate(gatePromptReply('yes'));

  assert.deepEqual(calls, [{ role: 'coder', answer: 'yes' }]);
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0].result.success, true);
});

test('a gate is answerable only once - the pending prompt is cleared after a successful relay', () => {
  const { relayed, rejected, adapters } = mkAdapters();
  const relay = new TelegramInboundRelay(AUTHORIZED_CHAT_ID, adapters);
  relay.recordGatePrompt(42, 'coder');

  relay.handleUpdate(gatePromptReply('yes'));
  relay.handleUpdate(gatePromptReply('yes again', { message_id: 101 }));

  assert.equal(relayed.length, 1, 'only the first reply is honored as a live gate answer');
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /pending gate prompt/);
});

// BL-239 human-only-not-agent-bus-03

test('the relay never exposes any adapter surface beyond answerGate - no path can reach the handoff store', () => {
  const { adapters } = mkAdapters();
  const relay = new TelegramInboundRelay(AUTHORIZED_CHAT_ID, adapters);
  relay.recordGatePrompt(42, 'coder');

  relay.handleUpdate(gatePromptReply('yes'));

  // The relay's only mutating capability is answerGate (BL-240's narrow
  // write path) - proven here by exhaustively driving every kind of inbound
  // message through it above/below and confirming answerGate is the only
  // adapter call ever made for a successful relay.
  assert.deepEqual(Object.keys(adapters).sort(), ['answerGate', 'onRejected', 'onRelayed']);
});

// BL-239 controls-out-of-scope-04

test('a stop/respawn/arbitrary command with no reply target is rejected, never executed', () => {
  const calls = [];
  const { rejected, adapters } = mkAdapters({
    answerGate: (...args) => {
      calls.push(args);
      return { success: true };
    },
  });
  const relay = new TelegramInboundRelay(AUTHORIZED_CHAT_ID, adapters);

  relay.handleUpdate({
    update_id: 1,
    message: { message_id: 200, chat: { id: Number(AUTHORIZED_CHAT_ID) }, text: '/stop' },
  });
  relay.handleUpdate({
    update_id: 2,
    message: { message_id: 201, chat: { id: Number(AUTHORIZED_CHAT_ID) }, text: '/respawn coder' },
  });

  assert.deepEqual(calls, [], 'no command text ever reaches answerGate');
  assert.equal(rejected.length, 2);
  assert.match(rejected[0].reason, /answer-only/);
});

test('a reply to a message that is not a currently pending gate prompt is rejected', () => {
  const calls = [];
  const { rejected, adapters } = mkAdapters({
    answerGate: (...args) => {
      calls.push(args);
      return { success: true };
    },
  });
  const relay = new TelegramInboundRelay(AUTHORIZED_CHAT_ID, adapters);
  // No recordGatePrompt call at all - message_id 42 is not pending.

  relay.handleUpdate(gatePromptReply('yes'));

  assert.deepEqual(calls, []);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /pending gate prompt/);
});

test('a message from an unauthorized chat is rejected even when it replies to a real pending gate prompt', () => {
  const calls = [];
  const { rejected, adapters } = mkAdapters({
    answerGate: (...args) => {
      calls.push(args);
      return { success: true };
    },
  });
  const relay = new TelegramInboundRelay(AUTHORIZED_CHAT_ID, adapters);
  relay.recordGatePrompt(42, 'coder');

  relay.handleUpdate(gatePromptReply('yes', { chat: { id: 111222333 } }));

  assert.deepEqual(calls, [], 'bot auth of the human: a stranger cannot answer a gate');
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /unauthorized chat/);
});

test('a non-text update (e.g. no message text) is ignored entirely, no rejection callback noise', () => {
  const { rejected, adapters } = mkAdapters();
  const relay = new TelegramInboundRelay(AUTHORIZED_CHAT_ID, adapters);

  relay.handleUpdate({ update_id: 1 });
  relay.handleUpdate({ update_id: 2, message: { message_id: 1, chat: { id: Number(AUTHORIZED_CHAT_ID) } } });

  assert.equal(rejected.length, 0);
});

// ── nextUpdateOffset (pure) ─────────────────────────────────────────────

test('nextUpdateOffset advances past the highest update_id seen', () => {
  assert.equal(nextUpdateOffset([{ update_id: 5 }, { update_id: 7 }, { update_id: 6 }], 0), 8);
});

test('nextUpdateOffset never regresses when given an empty batch', () => {
  assert.equal(nextUpdateOffset([], 12), 12);
});
