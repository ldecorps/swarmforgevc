const assert = require('node:assert/strict');
const {
  CURSOR_BRIDGE_TOPIC_NAME,
  AGENT_RUN_HEARTBEAT_INTERVAL_MS,
  decideEnsureCursorTopicAction,
  decideInboundAction,
  gateBusy,
  splitTelegramChunks,
  collectAssistantTextFromMessages,
  parseCursorBridgeState,
  formatStatusMessage,
  formatHelpMessage,
  decidePollBackoffMs,
  DEFAULT_POLL_BACKOFF,
  frontDeskTopicMapWithoutCursorBridge,
  isActiveRunConflict,
} = require('../out/tools/telegramCursorBridgeCore');

const CHAT_ID = '-100123';
const PRINCIPAL_ID = 42;
const CURSOR_TOPIC_ID = 7501;

function event(text, { fromId = PRINCIPAL_ID, chatId = CHAT_ID, topicId = CURSOR_TOPIC_ID } = {}) {
  return { fromId, chatId, topicId, text };
}

// ── topic ensure ─────────────────────────────────────────────────────────

test('cursor bridge: creates a standing topic when none is bound yet', () => {
  assert.deepEqual(decideEnsureCursorTopicAction({}), { kind: 'create' });
});

test('cursor bridge: reuses an existing Cursor Remote topic binding', () => {
  assert.deepEqual(decideEnsureCursorTopicAction({ '7501': 'CURSOR_REMOTE' }), { kind: 'reuse', topicId: 7501 });
});

test('cursor bridge: standing topic name is Cursor Remote', () => {
  assert.equal(CURSOR_BRIDGE_TOPIC_NAME, 'Cursor Remote');
});

test('cursor bridge: front desk topic map strips a stale SUP binding on the cursor topic id', () => {
  const scrubbed = frontDeskTopicMapWithoutCursorBridge({ '8435': 'SUP-12', '2286': 'BACKLOG' }, 8435);
  assert.deepEqual(scrubbed, { '2286': 'BACKLOG' });
});

test('cursor bridge: front desk topic map is unchanged when cursor topic is unbound', () => {
  const map = { '8435': 'SUP-12' };
  assert.deepEqual(frontDeskTopicMapWithoutCursorBridge(map, undefined), map);
});

// ── guard order ──────────────────────────────────────────────────────────

test('cursor bridge: a message in the wrong chat is ignored', () => {
  assert.deepEqual(
    decideInboundAction(event('hello', { chatId: '-999' }), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID),
    { action: 'ignore' }
  );
});

test('cursor bridge: a message outside the cursor topic is ignored', () => {
  assert.deepEqual(
    decideInboundAction(event('hello', { topicId: 5 }), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID),
    { action: 'ignore' }
  );
});

test('cursor bridge: while no cursor topic is bound yet, every message is ignored', () => {
  assert.deepEqual(decideInboundAction(event('/help'), PRINCIPAL_ID, CHAT_ID, undefined), { action: 'ignore' });
});

test('cursor bridge: an unauthorised sender in the cursor topic is refused', () => {
  assert.deepEqual(
    decideInboundAction(event('hello', { fromId: 999 }), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID),
    { action: 'refuse' }
  );
});

test('cursor bridge: whitespace-only text is ignored', () => {
  assert.deepEqual(decideInboundAction(event('   '), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), { action: 'ignore' });
});

// ── commands ─────────────────────────────────────────────────────────────

test('cursor bridge: /help in the cursor topic returns help', () => {
  assert.deepEqual(decideInboundAction(event('/help'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), { action: 'help' });
});

test('cursor bridge: /status returns status', () => {
  assert.deepEqual(decideInboundAction(event('/status'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), { action: 'status' });
});

test('cursor bridge: /new starts a fresh session', () => {
  assert.deepEqual(decideInboundAction(event('/new'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), { action: 'new-session' });
});

test('cursor bridge: slash commands are case and whitespace tolerant', () => {
  assert.deepEqual(decideInboundAction(event('  /NEW  '), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), { action: 'new-session' });
});

test('cursor bridge: ordinary text becomes a prompt', () => {
  assert.deepEqual(decideInboundAction(event('ship BL-624'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'prompt',
    text: 'ship BL-624',
  });
});

// ── busy gate ────────────────────────────────────────────────────────────

test('cursor bridge: a prompt while busy is rejected as busy', () => {
  assert.deepEqual(gateBusy({ action: 'prompt', text: 'hi' }, true), { action: 'busy' });
});

test('cursor bridge: /new and /status still work while busy', () => {
  assert.deepEqual(gateBusy({ action: 'new-session' }, true), { action: 'new-session' });
  assert.deepEqual(gateBusy({ action: 'status' }, true), { action: 'status' });
});

// ── telegram chunking ────────────────────────────────────────────────────

test('cursor bridge: short text is one chunk', () => {
  assert.deepEqual(splitTelegramChunks('hello'), ['hello']);
});

test('cursor bridge: long text is split into multiple chunks under the limit', () => {
  const chunks = splitTelegramChunks('a'.repeat(5000), 4096);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((c) => c.length <= 4096));
  assert.equal(chunks.join(''), 'a'.repeat(5000));
});

test('cursor bridge: prefers splitting on newlines when possible', () => {
  const line = 'x'.repeat(100);
  const text = `${line}\n${line}\n${line}`;
  const chunks = splitTelegramChunks(text, 220);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks.join('\n'), text);
});

// ── assistant text extraction ────────────────────────────────────────────

test('cursor bridge: collects assistant text blocks from stream messages', () => {
  const text = collectAssistantTextFromMessages([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello ' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'world' }] } },
    { type: 'tool_call', name: 'grep' },
  ]);
  assert.equal(text, 'Hello world');
});

test('cursor bridge: empty or non-assistant messages yield empty text', () => {
  assert.equal(collectAssistantTextFromMessages([]), '');
  assert.equal(collectAssistantTextFromMessages([{ type: 'status', status: 'RUNNING' }]), '');
  assert.equal(collectAssistantTextFromMessages([{ type: 'assistant', message: 'plain string' }]), '');
});

// ── persisted state ──────────────────────────────────────────────────────

test('cursor bridge: parseCursorBridgeState accepts a valid snapshot', () => {
  assert.deepEqual(parseCursorBridgeState({ updateOffset: 3, cursorTopicId: 7501, agentId: 'local-abc' }), {
    updateOffset: 3,
    cursorTopicId: 7501,
    agentId: 'local-abc',
  });
});

test('cursor bridge: parseCursorBridgeState defaults missing fields safely', () => {
  assert.deepEqual(parseCursorBridgeState(null), { updateOffset: 0 });
  assert.deepEqual(parseCursorBridgeState({}), { updateOffset: 0 });
});

test('cursor bridge: parseCursorBridgeState rejects negative offsets and empty agent ids', () => {
  assert.deepEqual(parseCursorBridgeState({ updateOffset: -3, agentId: '', cursorTopicId: 'nope' }), { updateOffset: 0 });
});

// ── status / help copy ───────────────────────────────────────────────────

test('cursor bridge: formatStatusMessage reports agent and topic ids', () => {
  const msg = formatStatusMessage({ updateOffset: 1, cursorTopicId: 7501, agentId: 'local-abc' }, false);
  assert.match(msg, /local-abc/);
  assert.match(msg, /7501/);
  assert.match(msg, /idle/i);
});

test('cursor bridge: formatStatusMessage reports busy when a run is in flight', () => {
  assert.match(formatStatusMessage({ updateOffset: 0 }, true), /busy/i);
});

test('cursor bridge: formatHelpMessage mentions /new and /status', () => {
  const help = formatHelpMessage();
  assert.match(help, /\/new/i);
  assert.match(help, /\/status/i);
});

// ── poll backoff ─────────────────────────────────────────────────────────

test('cursor bridge: decidePollBackoffMs is zero after a successful cycle', () => {
  assert.equal(decidePollBackoffMs(0, DEFAULT_POLL_BACKOFF), 0);
});

test('cursor bridge: decidePollBackoffMs grows exponentially up to the cap', () => {
  assert.equal(decidePollBackoffMs(1, { baseMs: 1000, maxMs: 8000 }), 1000);
  assert.equal(decidePollBackoffMs(3, { baseMs: 1000, maxMs: 8000 }), 4000);
  assert.equal(decidePollBackoffMs(10, { baseMs: 1000, maxMs: 8000 }), 8000);
});

test('cursor bridge: isActiveRunConflict detects stale Cursor SDK sessions', () => {
  assert.equal(
    isActiveRunConflict('Agent agent-28ff703f-ca98-4f34-9051-302569f044e3 already has active run'),
    true
  );
  assert.equal(isActiveRunConflict('network timeout'), false);
});

test('cursor bridge: agent-run heartbeat interval stays inside the supervisor stall window', () => {
  const stallMs = 120_000;
  assert.ok(AGENT_RUN_HEARTBEAT_INTERVAL_MS < stallMs);
  assert.ok(AGENT_RUN_HEARTBEAT_INTERVAL_MS <= stallMs / 3);
});
