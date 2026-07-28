const assert = require('node:assert/strict');
const {
  CURSOR_BRIDGE_SUBJECT_ID,
  CURSOR_BRIDGE_TOPIC_NAME,
  TELEGRAM_MESSAGE_MAX_LENGTH,
  AGENT_RUN_HEARTBEAT_INTERVAL_MS,
  decideEnsureCursorTopicAction,
  cursorBridgeTopicIdFromMap,
  isCursorBridgeTopic,
  isScopedToCursorTopic,
  isAuthorizedPrincipal,
  parseCommand,
  decideInboundAction,
  gateBusy,
  splitTelegramChunks,
  collectAssistantTextFromMessages,
  parseCursorBridgeState,
  parseNonNegativeInt,
  normalizedAssistantContentBlocks,
  isPlainAssistantStringMessage,
  isCursorBridgePersistedRecord,
  formatStatusMessage,
  formatHelpMessage,
  decidePollBackoffMs,
  DEFAULT_POLL_BACKOFF,
  frontDeskTopicMapWithoutCursorBridge,
  isActiveRunConflict,
} = require('../out/tools/telegramCursorBridgeCore');
const { TELEGRAM_PHOTO_DEFAULT_PROMPT } = require('../out/bridge/cursorBridgeTelegramMedia');

const CHAT_ID = '-100123';
const PRINCIPAL_ID = 42;
const CURSOR_TOPIC_ID = 7501;

function event(text, { fromId = PRINCIPAL_ID, chatId = CHAT_ID, topicId = CURSOR_TOPIC_ID, photoFileId } = {}) {
  return { fromId, chatId, topicId, text, ...(photoFileId ? { photoFileId } : {}) };
}

// ── topic ensure ─────────────────────────────────────────────────────────

test('cursor bridge: creates a standing topic when none is bound yet', () => {
  assert.deepEqual(decideEnsureCursorTopicAction({}), { kind: 'create' });
});

test('cursor bridge: reuses an existing Cursor Remote topic binding', () => {
  assert.deepEqual(decideEnsureCursorTopicAction({ '7501': 'CURSOR_REMOTE' }), { kind: 'reuse', topicId: 7501 });
});

test('cursor bridge: cursorBridgeTopicIdFromMap reads the CURSOR_REMOTE binding', () => {
  assert.equal(cursorBridgeTopicIdFromMap({ '7501': 'CURSOR_REMOTE' }), 7501);
  assert.equal(cursorBridgeTopicIdFromMap({ '7501': 'SUP-12' }), undefined);
  assert.equal(cursorBridgeTopicIdFromMap({}), undefined);
});

test('cursor bridge: isCursorBridgeTopic matches only the bound cursor topic', () => {
  assert.equal(isCursorBridgeTopic(7501, 7501), true);
  assert.equal(isCursorBridgeTopic(5, 7501), false);
  assert.equal(isCursorBridgeTopic(7501, undefined), false);
  assert.equal(isCursorBridgeTopic(undefined, 7501), false);
  assert.equal(isCursorBridgeTopic(undefined, undefined), false);
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

test('cursor bridge: front desk topic map is unchanged when the cursor topic id is not in the map', () => {
  const map = { '2286': 'BACKLOG' };
  assert.deepEqual(frontDeskTopicMapWithoutCursorBridge(map, 8435), map);
  assert.equal(frontDeskTopicMapWithoutCursorBridge(map, 8435), map);
});

test('cursor bridge: front desk topic map ignores a literal undefined topic key when unbound', () => {
  const map = { undefined: 'SUP-12', '2286': 'BACKLOG' };
  assert.deepEqual(frontDeskTopicMapWithoutCursorBridge(map, undefined), map);
});

// ── guard order ──────────────────────────────────────────────────────────

test('cursor bridge: isScopedToCursorTopic requires a bound cursor topic id', () => {
  assert.equal(
    isScopedToCursorTopic({ chatId: CHAT_ID, topicId: CURSOR_TOPIC_ID }, CHAT_ID, undefined),
    false
  );
  assert.equal(
    isScopedToCursorTopic({ chatId: CHAT_ID, topicId: undefined }, CHAT_ID, undefined),
    false
  );
  assert.equal(
    isScopedToCursorTopic({ chatId: CHAT_ID, topicId: CURSOR_TOPIC_ID }, CHAT_ID, CURSOR_TOPIC_ID),
    true
  );
});

test('cursor bridge: isScopedToCursorTopic rejects the wrong chat or topic', () => {
  assert.equal(
    isScopedToCursorTopic({ chatId: '-999', topicId: CURSOR_TOPIC_ID }, CHAT_ID, CURSOR_TOPIC_ID),
    false
  );
  assert.equal(
    isScopedToCursorTopic({ chatId: CHAT_ID, topicId: 5 }, CHAT_ID, CURSOR_TOPIC_ID),
    false
  );
});

test('cursor bridge: isAuthorizedPrincipal compares ids as strings', () => {
  assert.equal(isAuthorizedPrincipal(42, '42'), true);
  assert.equal(isAuthorizedPrincipal('42', 42), true);
  assert.equal(isAuthorizedPrincipal(999, PRINCIPAL_ID), false);
});

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

test('cursor bridge: photo-only inbound becomes a multimodal prompt', () => {
  assert.deepEqual(decideInboundAction(event('', { photoFileId: 'photo-1' }), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'prompt',
    text: TELEGRAM_PHOTO_DEFAULT_PROMPT,
    photoFileIds: ['photo-1'],
  });
});

test('cursor bridge: photo caption becomes the prompt text', () => {
  assert.deepEqual(
    decideInboundAction(event('explain this UI', { photoFileId: 'photo-2' }), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID),
    { action: 'prompt', text: 'explain this UI', photoFileIds: ['photo-2'] }
  );
});

// ── commands ─────────────────────────────────────────────────────────────

test('cursor bridge: /help in the cursor topic returns help', () => {
  assert.deepEqual(decideInboundAction(event('/help'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), { action: 'help' });
});

test('cursor bridge: /status returns status', () => {
  assert.deepEqual(decideInboundAction(event('/status'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), { action: 'status' });
});

test('cursor bridge: /update returns update', () => {
  assert.deepEqual(decideInboundAction(event('/update'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), { action: 'update' });
  assert.deepEqual(decideInboundAction(event('  /UPDATE  '), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), { action: 'update' });
});

test('cursor bridge: /new starts a fresh session', () => {
  assert.deepEqual(decideInboundAction(event('/new'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), { action: 'new-session' });
});

test('cursor bridge: slash commands are case and whitespace tolerant', () => {
  assert.deepEqual(decideInboundAction(event('  /NEW  '), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), { action: 'new-session' });
});

test('cursor bridge: parseCommand trims whitespace before matching slash verbs', () => {
  assert.equal(parseCommand('  /help  '), 'help');
  assert.equal(parseCommand('\n/status\n'), 'status');
  assert.equal(parseCommand('  /new'), 'new');
});

test('cursor bridge: ordinary text becomes a prompt', () => {
  assert.deepEqual(decideInboundAction(event('ship BL-624'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'prompt',
    text: 'ship BL-624',
  });
});

test('cursor bridge: /log parses auto and named targets', () => {
  assert.deepEqual(decideInboundAction(event('/log'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'log',
    target: { kind: 'auto' },
  });
  assert.deepEqual(decideInboundAction(event('/log expedite BL-624'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'log',
    target: { kind: 'expedite', ticket: 'BL-624' },
  });
  assert.deepEqual(decideInboundAction(event('/log redeploy'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'log',
    target: { kind: 'redeploy' },
  });
});

test('cursor bridge: /redeploy parses exact command', () => {
  assert.deepEqual(decideInboundAction(event('/redeploy'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'redeploy',
  });
  assert.deepEqual(decideInboundAction(event('  /REDEPLOY  '), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'redeploy',
  });
  assert.deepEqual(decideInboundAction(event('/redeploy now'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'prompt',
    text: '/redeploy now',
  });
});

test('cursor bridge: /expedite parses default and explicit ticket', () => {
  assert.deepEqual(decideInboundAction(event('/expedite'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'expedite',
    ticket: 'BL-696',
  });
  assert.deepEqual(decideInboundAction(event('/expedite BL-624'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'expedite',
    ticket: 'BL-624',
  });
  assert.deepEqual(decideInboundAction(event('  /EXPEDITE bl-100  '), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'expedite',
    ticket: 'BL-100',
  });
});

test('cursor bridge: /reexpedite parses default and explicit ticket', () => {
  assert.deepEqual(decideInboundAction(event('/reexpedite'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'reexpedite',
    ticket: 'BL-696',
  });
  assert.deepEqual(decideInboundAction(event('/reexpedite BL-624'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'reexpedite',
    ticket: 'BL-624',
  });
});

test('cursor bridge: reexpedite while busy is rejected as busy', () => {
  assert.deepEqual(gateBusy({ action: 'reexpedite', ticket: 'BL-696' }, true), { action: 'busy' });
});

test('cursor bridge: invalid /expedite ticket falls through to prompt', () => {
  assert.deepEqual(decideInboundAction(event('/expedite NOPE'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'prompt',
    text: '/expedite NOPE',
  });
});

test('cursor bridge: expedite while busy is rejected as busy', () => {
  assert.deepEqual(gateBusy({ action: 'expedite', ticket: 'BL-696' }, true), { action: 'busy' });
});


test('cursor bridge: a prompt while busy is rejected as busy', () => {
  assert.deepEqual(gateBusy({ action: 'prompt', text: 'hi' }, true), { action: 'busy' });
});

test('cursor bridge: /new and /status still work while busy', () => {
  assert.deepEqual(gateBusy({ action: 'new-session' }, true), { action: 'new-session' });
  assert.deepEqual(gateBusy({ action: 'status' }, true), { action: 'status' });
  assert.deepEqual(gateBusy({ action: 'update' }, true), { action: 'update' });
});

test('cursor bridge: help, ignore, and refuse are not blocked by the busy gate', () => {
  assert.deepEqual(gateBusy({ action: 'help' }, true), { action: 'help' });
  assert.deepEqual(gateBusy({ action: 'ignore' }, true), { action: 'ignore' });
  assert.deepEqual(gateBusy({ action: 'refuse' }, true), { action: 'refuse' });
  assert.deepEqual(gateBusy({ action: 'prompt', text: 'hi' }, false), { action: 'prompt', text: 'hi' });
});

// ── telegram chunking ────────────────────────────────────────────────────

test('cursor bridge: short text is one chunk', () => {
  assert.deepEqual(splitTelegramChunks('hello'), ['hello']);
});

test('cursor bridge: empty text is one empty chunk', () => {
  assert.deepEqual(splitTelegramChunks(''), ['']);
  assert.deepEqual(splitTelegramChunks('', 0), ['']);
});

test('cursor bridge: text exactly at the limit stays a single chunk', () => {
  const exact = 'x'.repeat(TELEGRAM_MESSAGE_MAX_LENGTH);
  assert.deepEqual(splitTelegramChunks(exact), [exact]);
  assert.deepEqual(splitTelegramChunks('x'.repeat(10), 10), ['x'.repeat(10)]);
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

test('cursor bridge: splits on byte limit when no newline is available', () => {
  assert.deepEqual(splitTelegramChunks('b'.repeat(25), 10), ['b'.repeat(10), 'b'.repeat(10), 'bbbbb']);
  assert.deepEqual(splitTelegramChunks('a'.repeat(20), 10), ['a'.repeat(10), 'a'.repeat(10)]);
});

test('cursor bridge: treats a leading newline before the split window as a hard cut', () => {
  assert.deepEqual(splitTelegramChunks(`\n${'a'.repeat(15)}`, 10), [`\n${'a'.repeat(9)}`, 'aaaaaa']);
});

test('cursor bridge: trims a leading newline after splitting on a line boundary', () => {
  assert.deepEqual(splitTelegramChunks(`${'a'.repeat(10)}\n${'b'.repeat(10)}`, 10), ['a'.repeat(10), 'b'.repeat(10)]);
});

test('cursor bridge: does not append an empty trailing chunk after a trailing newline split', () => {
  assert.deepEqual(splitTelegramChunks(`${'a'.repeat(4)}\n`, 4), ['aaaa']);
});

test('cursor bridge: keeps every newline when splitting on a small max length', () => {
  assert.deepEqual(splitTelegramChunks('\n'.repeat(5), 2), ['\n\n', '\n\n']);
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

test('cursor bridge: ignores non-text blocks and malformed assistant payloads', () => {
  assert.equal(
    collectAssistantTextFromMessages([
      { type: 'assistant', message: { content: [{ type: 'image', text: 'ignored' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 42 }] } },
      { type: 'assistant', message: null },
      { type: 'assistant' },
      { type: 'user', message: { content: [{ type: 'text', text: 'nope' }] } },
    ]),
    ''
  );
});

test('cursor bridge: assistant messages with missing content still yield empty text', () => {
  assert.equal(collectAssistantTextFromMessages([{ type: 'assistant', message: { role: 'assistant' } }]), '');
  assert.equal(
    collectAssistantTextFromMessages([{ type: 'assistant', message: { role: 'assistant', content: undefined } }]),
    ''
  );
});

test('cursor bridge: rejects plain-string assistant payloads without object content', () => {
  assert.equal(collectAssistantTextFromMessages([{ type: 'assistant', message: 'plain string' }]), '');
  assert.equal(collectAssistantTextFromMessages([{ type: 'assistant', message: '' }]), '');
  assert.equal(collectAssistantTextFromMessages([{ type: 'assistant', message: null }]), '');
  assert.equal(collectAssistantTextFromMessages([{ type: 'assistant', message: 42 }]), '');
  assert.equal(
    collectAssistantTextFromMessages([{ type: 'assistant', message: { role: 'assistant', content: null } }]),
    ''
  );
  const boxedString = Object.assign(Object('plain string'), {
    content: [{ type: 'text', text: 'leak' }],
  });
  assert.equal(isPlainAssistantStringMessage(boxedString), true);
  assert.equal(collectAssistantTextFromMessages([{ type: 'assistant', message: boxedString }]), '');
});

test('cursor bridge: parseNonNegativeInt preserves zero and rejects negatives', () => {
  assert.equal(parseNonNegativeInt(0, 99), 0);
  assert.equal(parseNonNegativeInt(-1, 99), 99);
  assert.equal(parseNonNegativeInt('3', 99), 99);
});

test('cursor bridge: normalizedAssistantContentBlocks treats nullish content as empty', () => {
  assert.deepEqual(normalizedAssistantContentBlocks(undefined), []);
  assert.deepEqual(normalizedAssistantContentBlocks(null), []);
  assert.deepEqual(normalizedAssistantContentBlocks([{ type: 'text', text: 'ok' }]), [{ type: 'text', text: 'ok' }]);
});

test('cursor bridge: isPlainAssistantStringMessage detects boxed and plain strings only', () => {
  assert.equal(isPlainAssistantStringMessage('plain string'), true);
  assert.equal(isPlainAssistantStringMessage(Object('plain string')), true);
  assert.equal(isPlainAssistantStringMessage({ content: [] }), false);
});

test('cursor bridge: isCursorBridgePersistedRecord accepts plain objects only', () => {
  assert.equal(isCursorBridgePersistedRecord({ updateOffset: 1 }), true);
  assert.equal(isCursorBridgePersistedRecord(null), false);
  assert.equal(isCursorBridgePersistedRecord(undefined), false);
  assert.equal(isCursorBridgePersistedRecord('not-json'), false);
  assert.equal(isCursorBridgePersistedRecord([]), false);
  assert.equal(isCursorBridgePersistedRecord(Object.assign([], { updateOffset: 3 })), false);
});

test('cursor bridge: parseCursorBridgeState rejects array-shaped snapshots', () => {
  assert.deepEqual(parseCursorBridgeState(Object.assign([], { updateOffset: 3 })), { updateOffset: 0 });
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
  assert.deepEqual(parseCursorBridgeState(undefined), { updateOffset: 0 });
  assert.deepEqual(parseCursorBridgeState({}), { updateOffset: 0 });
  assert.deepEqual(parseCursorBridgeState('not-json'), { updateOffset: 0 });
  assert.deepEqual(parseCursorBridgeState(0), { updateOffset: 0 });
});

test('cursor bridge: parseCursorBridgeState accepts zero update offsets and partial snapshots', () => {
  assert.deepEqual(parseCursorBridgeState({ updateOffset: 0, cursorTopicId: 7501 }), {
    updateOffset: 0,
    cursorTopicId: 7501,
  });
  assert.deepEqual(parseCursorBridgeState({ updateOffset: 0, agentId: 'local-abc' }), {
    updateOffset: 0,
    agentId: 'local-abc',
  });
  assert.deepEqual(parseCursorBridgeState({ updateOffset: 0.5 }), { updateOffset: 0.5 });
});

test('cursor bridge: parseCursorBridgeState rejects negative offsets and empty agent ids', () => {
  assert.deepEqual(parseCursorBridgeState({ updateOffset: -3, agentId: '', cursorTopicId: 'nope' }), { updateOffset: 0 });
  assert.deepEqual(parseCursorBridgeState({ updateOffset: '3' }), { updateOffset: 0 });
});

// ── status / help copy ───────────────────────────────────────────────────

test('cursor bridge: formatStatusMessage reports agent and topic ids', () => {
  const msg = formatStatusMessage({ updateOffset: 1, cursorTopicId: 7501, agentId: 'local-abc' }, false);
  assert.match(msg, /local-abc/);
  assert.match(msg, /7501/);
  assert.match(msg, /idle/i);
});

test('cursor bridge: formatStatusMessage reports busy when a run is in flight', () => {
  assert.equal(
    formatStatusMessage({ updateOffset: 0 }, true),
    'Cursor bridge status\nTopic: (unbound)\nAgent: (none — next message starts a session)\nMode: busy (run in flight)'
  );
});

test('cursor bridge: formatStatusMessage reports idle defaults when unbound', () => {
  assert.equal(
    formatStatusMessage({ updateOffset: 0 }, false),
    'Cursor bridge status\nTopic: (unbound)\nAgent: (none — next message starts a session)\nMode: idle'
  );
});

test('cursor bridge: formatHelpMessage mentions all operator commands', () => {
  const help = formatHelpMessage();
  assert.equal(
    help,
    [
      'Cursor remote control',
      '',
      'Send any message or photo to run the local Cursor agent against this repo.',
      '',
      '/new — start a fresh agent session',
      '/status — show session state',
      '/update — short summary of agent / expedite / swarm activity (works while busy)',
      '/expedite [BL-xxx] — run offline expeditor with stage updates (default BL-696)',
      '/reexpedite [BL-xxx] — checkpoint main WIP and restart a divergent expedite',
      '/redeploy — compile extension and restart this bridge',
      '/log [expedite|redeploy|bridge] — tail the active or named operator log',
      '/help — this message',
    ].join('\n')
  );
  assert.match(help, /\/new/i);
  assert.match(help, /\/status/i);
  assert.match(help, /\/update/i);
  assert.match(help, /\/expedite/i);
  assert.match(help, /\/reexpedite/i);
  assert.match(help, /\/redeploy/i);
  assert.match(help, /\/log/i);
});

// ── poll backoff ─────────────────────────────────────────────────────────

test('cursor bridge: DEFAULT_POLL_BACKOFF matches the documented poll backoff defaults', () => {
  assert.deepEqual(DEFAULT_POLL_BACKOFF, { baseMs: 1000, maxMs: 60_000 });
  assert.equal(decidePollBackoffMs(1), 1000);
  assert.equal(decidePollBackoffMs(3), 4000);
});

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
  assert.equal(isActiveRunConflict('Agent ALREADY HAS ACTIVE RUN'), true);
  assert.equal(isActiveRunConflict('network timeout'), false);
});

test('cursor bridge: agent-run heartbeat interval stays inside the supervisor stall window', () => {
  assert.equal(AGENT_RUN_HEARTBEAT_INTERVAL_MS, 30_000);
  const stallMs = 120_000;
  assert.ok(AGENT_RUN_HEARTBEAT_INTERVAL_MS < stallMs);
  assert.ok(AGENT_RUN_HEARTBEAT_INTERVAL_MS <= stallMs / 3);
});

test('cursor bridge: CURSOR_BRIDGE_SUBJECT_ID is the standing topic-map subject', () => {
  assert.equal(CURSOR_BRIDGE_SUBJECT_ID, 'CURSOR_REMOTE');
});
