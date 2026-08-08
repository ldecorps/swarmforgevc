const assert = require('node:assert/strict');
const {
  CURSOR_BRIDGE_SUBJECT_ID,
  CURSOR_BRIDGE_TOPIC_NAME,
  TELEGRAM_MESSAGE_MAX_LENGTH,
  AGENT_RUN_HEARTBEAT_INTERVAL_MS,
  decideEnsureCursorTopicAction,
  cursorBridgeTopicIdFromMap,
  bubbleTopicIdFromMap,
  BUBBLE_SUBJECT_ID,
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
  isCursorAuthError,
  isCursorConnectionFailure,
  shouldResetCursorAgentSession,
  isCursorResourceExhausted,
  parseCursorBridgeCliArgs,
  shouldUseCursorBridgeInboundQueue,
  CURSOR_BRIDGE_CLI_USAGE,
  BUBBLE_TOPIC_NAME,
  decideEnsureBubbleTopicAction,
  normalizeCursorBridgeTopicScope,
  isOwnedCursorBridgeTopic,
} = require('../out/tools/telegramCursorBridgeCore');
const { TELEGRAM_PHOTO_DEFAULT_PROMPT } = require('../out/bridge/cursorBridgeTelegramMedia');

const CHAT_ID = '-100123';
const PRINCIPAL_ID = 42;
const CURSOR_TOPIC_ID = 7501;

function event(text, { fromId = PRINCIPAL_ID, chatId = CHAT_ID, topicId = CURSOR_TOPIC_ID, photoFileId } = {}) {
  return { kind: 'text', fromId, chatId, topicId, text, ...(photoFileId ? { photoFileId } : {}) };
}

function callbackEvent(callbackData, { fromId = PRINCIPAL_ID, chatId = CHAT_ID, topicId = CURSOR_TOPIC_ID } = {}) {
  return { kind: 'callback', fromId, chatId, topicId, text: '', callbackData };
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

test('cursor bridge: bubbleTopicIdFromMap reads the BUBBLE binding', () => {
  assert.equal(BUBBLE_SUBJECT_ID, 'BUBBLE');
  assert.equal(bubbleTopicIdFromMap({ '11810': 'BUBBLE', '8435': 'CURSOR_REMOTE' }), 11810);
  assert.equal(bubbleTopicIdFromMap({ '8435': 'CURSOR_REMOTE' }), undefined);
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

test('cursor bridge: front desk topic map strips BOTH the cursor and an extra (Bubble) stale binding — not just the last one processed', () => {
  // Regression guard: a naive re-copy-from-original per matched id would
  // reset the accumulator on the second strip and silently resurrect the
  // first one. Two real stale bindings must both end up gone.
  const scrubbed = frontDeskTopicMapWithoutCursorBridge(
    { '8435': 'SUP-12', '9001': 'SUP-34', '2286': 'BACKLOG' },
    8435,
    [9001]
  );
  assert.deepEqual(scrubbed, { '2286': 'BACKLOG' });
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

// Live.js already passes a topics bag; a bare number must keep working too.
const BUBBLE_TOPIC_ID = 11810;
const TOPICS = { cursorTopicId: CURSOR_TOPIC_ID, bubbleTopicId: BUBBLE_TOPIC_ID };

test('cursor bridge: decideInboundAction accepts the Live topics bag for Host', () => {
  assert.deepEqual(
    decideInboundAction(event('hello from host'), PRINCIPAL_ID, CHAT_ID, TOPICS),
    { action: 'prompt', text: 'hello from host' }
  );
});

test('cursor bridge: decideInboundAction accepts the Live topics bag for Bubble', () => {
  assert.deepEqual(
    decideInboundAction(event('hello from bubble', { topicId: BUBBLE_TOPIC_ID }), PRINCIPAL_ID, CHAT_ID, TOPICS),
    { action: 'prompt', text: 'hello from bubble' }
  );
});

test('cursor bridge: topics bag still ignores an unbound / foreign topic', () => {
  assert.deepEqual(
    decideInboundAction(event('nope', { topicId: 999 }), PRINCIPAL_ID, CHAT_ID, TOPICS),
    { action: 'ignore' }
  );
});

test('cursor bridge: isScopedToCursorTopic accepts a topics bag (Host or Bubble)', () => {
  assert.equal(
    isScopedToCursorTopic({ chatId: CHAT_ID, topicId: CURSOR_TOPIC_ID }, CHAT_ID, TOPICS),
    true
  );
  assert.equal(
    isScopedToCursorTopic({ chatId: CHAT_ID, topicId: BUBBLE_TOPIC_ID }, CHAT_ID, TOPICS),
    true
  );
  assert.equal(
    isScopedToCursorTopic({ chatId: CHAT_ID, topicId: 5 }, CHAT_ID, TOPICS),
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

test('cursor bridge: /queue returns queue action', () => {
  assert.deepEqual(decideInboundAction(event('/queue'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), { action: 'queue' });
});

test('cursor bridge: /dequeue N parses queue removal action', () => {
  assert.deepEqual(decideInboundAction(event('/dequeue 2'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'dequeue',
    position: 2,
  });
  assert.deepEqual(decideInboundAction(event('/DEQUEUE 7'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'dequeue',
    position: 7,
  });
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

test('cursor bridge: /redeploy soft-confirms before execute (BL-702)', () => {
  assert.deepEqual(decideInboundAction(event('/redeploy'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'prompt-operator-confirm',
    tier: 'soft',
    verb: '/redeploy',
    args: undefined,
  });
  assert.deepEqual(decideInboundAction(event('  /REDEPLOY  '), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'prompt-operator-confirm',
    tier: 'soft',
    verb: '/redeploy',
    args: undefined,
  });
  assert.deepEqual(decideInboundAction(event('/redeploy now'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'prompt-operator-confirm',
    tier: 'soft',
    verb: '/redeploy',
    args: 'now',
  });
});

test('cursor bridge: /redeploy miniapp soft-confirms (BL-702)', () => {
  assert.deepEqual(decideInboundAction(event('/redeploy miniapp'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'prompt-operator-confirm',
    tier: 'soft',
    verb: '/redeploy',
    args: 'miniapp',
  });
  assert.deepEqual(decideInboundAction(event('/redeploy-miniapp'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'prompt-operator-confirm',
    tier: 'soft',
    verb: '/redeploy',
    args: 'miniapp',
  });
  assert.deepEqual(decideInboundAction(event('/redeploy mini app'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'prompt-operator-confirm',
    tier: 'soft',
    verb: '/redeploy',
    args: 'miniapp',
  });
});

test('BL-702: hard verb prompts confirm; unauthorised refuses without execute', () => {
  assert.deepEqual(decideInboundAction(event('/ensure'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'prompt-operator-confirm',
    tier: 'hard',
    verb: '/ensure',
    args: undefined,
  });
  assert.deepEqual(
    decideInboundAction(event('/restart', { fromId: 999 }), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID),
    { action: 'refuse' }
  );
  assert.deepEqual(
    decideInboundAction(event('/kill-all', { topicId: 5 }), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID),
    { action: 'ignore' }
  );
});

test('BL-702: soft compile prompts; confirm-off clears pending', () => {
  assert.deepEqual(decideInboundAction(event('/compile'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'prompt-operator-confirm',
    tier: 'soft',
    verb: '/compile',
    args: undefined,
  });
  assert.deepEqual(
    decideInboundAction(event('/confirm-off'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID, {
      tier: 'hard',
      verb: '/bounce',
    }),
    { action: 'clear-operator-pending' }
  );
});

test('BL-702: syncenv and doctor execute as read/soft appropriately', () => {
  assert.deepEqual(decideInboundAction(event('/doctor'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'execute-operator',
    verb: '/doctor',
    args: undefined,
  });
  assert.deepEqual(decideInboundAction(event('/syncenv'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'prompt-operator-confirm',
    tier: 'soft',
    verb: '/syncenv',
    args: undefined,
  });
});

test('BL-702: op:confirm callback executes pending hard verb', () => {
  assert.deepEqual(
    decideInboundAction(
      callbackEvent('op:confirm'),
      PRINCIPAL_ID,
      CHAT_ID,
      CURSOR_TOPIC_ID,
      { tier: 'hard', verb: '/ensure' }
    ),
    { action: 'execute-operator', verb: '/ensure', args: undefined }
  );
});

test('BL-702: op:cancel clears pending without execute', () => {
  assert.deepEqual(
    decideInboundAction(
      callbackEvent('op:cancel'),
      PRINCIPAL_ID,
      CHAT_ID,
      CURSOR_TOPIC_ID,
      { tier: 'hard', verb: '/bounce', args: 'swarm' }
    ),
    { action: 'cancel-operator-pending' }
  );
});

test('BL-702: soft confirm callback executes compile', () => {
  assert.deepEqual(
    decideInboundAction(
      callbackEvent('op:confirm'),
      PRINCIPAL_ID,
      CHAT_ID,
      CURSOR_TOPIC_ID,
      { tier: 'soft', verb: '/compile' }
    ),
    { action: 'execute-operator', verb: '/compile', args: undefined }
  );
});

test('BL-702: confirm with no pending is ignore', () => {
  assert.deepEqual(
    decideInboundAction(callbackEvent('op:confirm'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID),
    { action: 'ignore' }
  );
});

test('cursor bridge: /pilot parses default and explicit ticket', () => {
  assert.deepEqual(decideInboundAction(event('/pilot'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'pilot',
    ticket: 'BL-696',
  });
  assert.deepEqual(decideInboundAction(event('/pilot BL-624'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'pilot',
    ticket: 'BL-624',
  });
});

test('cursor bridge: pilot while busy is rejected as busy', () => {
  assert.deepEqual(gateBusy({ action: 'pilot', ticket: 'BL-696' }, true), { action: 'busy' });
});

test('cursor bridge: /pilot safe dispatches start and list variants', () => {
  assert.deepEqual(decideInboundAction(event('/pilot safe'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'pilot-safe-start',
  });
  assert.deepEqual(decideInboundAction(event('/pilot safe --list'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'pilot-safe-list',
  });
  assert.deepEqual(decideInboundAction(event('/pilot safe list'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'pilot-safe-list',
  });
  assert.deepEqual(decideInboundAction(event('/PILOT SAFE'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'pilot-safe-start',
  });
  // Explicit ticket ids still take the plain pilot path (BL-722 safe-04).
  assert.deepEqual(decideInboundAction(event('/pilot BL-650'), PRINCIPAL_ID, CHAT_ID, CURSOR_TOPIC_ID), {
    action: 'pilot',
    ticket: 'BL-650',
  });
});

test('cursor bridge: pilot safe start while busy is rejected as busy, list is not', () => {
  assert.deepEqual(gateBusy({ action: 'pilot-safe-start' }, true), { action: 'busy' });
  assert.deepEqual(gateBusy({ action: 'pilot-safe-list' }, true), { action: 'pilot-safe-list' });
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
  assert.deepEqual(gateBusy({ action: 'queue' }, true), { action: 'queue' });
  assert.deepEqual(gateBusy({ action: 'dequeue', position: 1 }, true), { action: 'dequeue', position: 1 });
  assert.deepEqual(gateBusy({ action: 'update' }, true), { action: 'update' });
});

test('cursor bridge: help, ignore, and refuse are not blocked by the busy gate', () => {
  assert.deepEqual(gateBusy({ action: 'help' }, true), { action: 'help' });
  assert.deepEqual(gateBusy({ action: 'ignore' }, true), { action: 'ignore' });
  assert.deepEqual(gateBusy({ action: 'refuse' }, true), { action: 'refuse' });
  assert.deepEqual(gateBusy({ action: 'prompt', text: 'hi' }, false), { action: 'prompt', text: 'hi' });
});

test('BL-703: busy gate blocks hydrate/autopilot/land execute', () => {
  assert.deepEqual(gateBusy({ action: 'execute-operator', verb: '/hydrate', args: 'x' }, true), {
    action: 'busy',
  });
  assert.deepEqual(gateBusy({ action: 'execute-operator', verb: '/autopilot' }, true), {
    action: 'busy',
  });
  assert.deepEqual(gateBusy({ action: 'execute-operator', verb: '/land' }, true), { action: 'busy' });
  assert.deepEqual(gateBusy({ action: 'execute-operator', verb: '/autopilot', args: 'dry' }, true), {
    action: 'execute-operator',
    verb: '/autopilot',
    args: 'dry',
  });
  assert.deepEqual(gateBusy({ action: 'execute-operator', verb: '/compile' }, true), {
    action: 'execute-operator',
    verb: '/compile',
  });
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

test('cursor bridge: parseCursorBridgeState accepts bubbleTopicId', () => {
  assert.deepEqual(
    parseCursorBridgeState({ updateOffset: 1, cursorTopicId: 9, bubbleTopicId: 91 }),
    { updateOffset: 1, cursorTopicId: 9, bubbleTopicId: 91 }
  );
});

test('cursor bridge: parseCursorBridgeState reads a well-formed livenessStatus in full', () => {
  assert.deepEqual(
    parseCursorBridgeState({
      updateOffset: 1,
      livenessStatus: { topicId: 7, messageId: 99, renderedText: 'Bridge: idle' },
    }),
    { updateOffset: 1, livenessStatus: { topicId: 7, messageId: 99, renderedText: 'Bridge: idle' } }
  );
});

test('cursor bridge: parseCursorBridgeState drops a present-but-malformed livenessStatus (not an object) rather than defaulting it silently to garbage', () => {
  assert.deepEqual(parseCursorBridgeState({ updateOffset: 1, livenessStatus: 'not-an-object' }), {
    updateOffset: 1,
  });
  assert.deepEqual(parseCursorBridgeState({ updateOffset: 1, livenessStatus: null }), { updateOffset: 1 });
  assert.deepEqual(parseCursorBridgeState({ updateOffset: 1, livenessStatus: 42 }), { updateOffset: 1 });
});

test('cursor bridge: parseCursorBridgeState omits livenessStatus entirely when every one of its fields is invalid', () => {
  const state = parseCursorBridgeState({
    updateOffset: 1,
    livenessStatus: { topicId: 'nope', messageId: 'nope', renderedText: '' },
  });
  assert.deepEqual(state, { updateOffset: 1 });
  assert.equal('livenessStatus' in state, false);
});

test('cursor bridge: parseCursorBridgeState keeps only the valid fields of a partially-malformed livenessStatus', () => {
  const state = parseCursorBridgeState({
    updateOffset: 1,
    livenessStatus: { topicId: 7, messageId: 'not-a-number', renderedText: 42 },
  });
  assert.deepEqual(state.livenessStatus, { topicId: 7 });
  assert.equal('messageId' in state.livenessStatus, false);
  assert.equal('renderedText' in state.livenessStatus, false);
});

test('cursor bridge: parseCursorBridgeState keeps a valid messageId alone (invalid topicId is a dropped key, not an undefined value)', () => {
  const state = parseCursorBridgeState({
    updateOffset: 1,
    livenessStatus: { topicId: 'nope', messageId: 99, renderedText: '' },
  });
  assert.deepEqual(state.livenessStatus, { messageId: 99 });
  assert.equal('topicId' in state.livenessStatus, false);
  assert.equal('renderedText' in state.livenessStatus, false);
});

test('cursor bridge: parseCursorBridgeState keeps a valid renderedText alone', () => {
  const state = parseCursorBridgeState({
    updateOffset: 1,
    livenessStatus: { topicId: 'nope', messageId: 'nope', renderedText: 'Bridge: busy' },
  });
  assert.deepEqual(state.livenessStatus, { renderedText: 'Bridge: busy' });
  assert.equal('topicId' in state.livenessStatus, false);
  assert.equal('messageId' in state.livenessStatus, false);
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

test('cursor bridge: parseCursorBridgeState accepts queued prompts and pending poll metadata', () => {
  const parsed = parseCursorBridgeState({
    updateOffset: 7,
    pendingPrompts: [
      { id: 'qp-1', text: 'First queued question', createdAtMs: 10 },
      { id: 'qp-2', text: 'Second queued question', createdAtMs: 20, replyToMessageId: 88 },
    ],
    pendingPromptPoll: { pollId: 'poll-1', itemIds: ['qp-1', 'qp-2'] },
  });
  assert.deepEqual(parsed.pendingPrompts, [
    { id: 'qp-1', text: 'First queued question', createdAtMs: 10 },
    { id: 'qp-2', text: 'Second queued question', createdAtMs: 20, replyToMessageId: 88 },
  ]);
  assert.deepEqual(parsed.pendingPromptPoll, { pollId: 'poll-1', itemIds: ['qp-1', 'qp-2'] });
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
    'Cursor bridge status\nTopic: (unbound)\nAgent: (none — next message starts a session)\nMode: busy (run in flight)\nQueued questions: 0'
  );
});

test('cursor bridge: formatStatusMessage reports idle defaults when unbound', () => {
  assert.equal(
    formatStatusMessage({ updateOffset: 0 }, false),
    'Cursor bridge status\nTopic: (unbound)\nAgent: (none — next message starts a session)\nMode: idle\nQueued questions: 0'
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
      '/queue — list queued questions',
      '/dequeue N — remove queued question #N',
      '/update — short summary of agent / expedite / swarm activity (works while busy)',
      '/pilot [BL-xxx] — Cursor agent staffs an offline expedition (default BL-696)',
      '/pilot safe [--list] — auto-pick (or list) the safe pilot pool: approved, low-mutation, specced defects',
      '/expedite [BL-xxx] — run automated offline expeditor with stage updates (default BL-696)',
      '/reexpedite [BL-xxx] — checkpoint main WIP and restart a divergent expedite',
      '/redeploy — soft confirm, then compile and restart this bridge (reloads swarm.env)',
      '/redeploy miniapp — soft confirm, then bounce the headless mini app bridge',
      '/pause — soft confirm; freeze new promotion until /resume (in-flight continues; useful on flaky data)',
      '/resume — soft confirm; allow promotion again',
      '/syncenv /compile /pull — soft confirm (one Confirm tap)',
      '/stop /start /restart /bounce [swarm|extension|bridge|all] /ensure — hard confirm',
      '/doctor /tunnel — read-only checks',
      '/confirm-off — clear a pending Confirm',
      '/log [expedite|redeploy|bridge] — tail the active or named operator log',
      '/help — this message',
    ].join('\n')
  );
  assert.match(help, /\/new/i);
  assert.match(help, /\/status/i);
  assert.match(help, /\/queue/i);
  assert.match(help, /\/dequeue/i);
  assert.match(help, /\/update/i);
  assert.match(help, /\/pilot/i);
  assert.match(help, /\/expedite/i);
  assert.match(help, /\/reexpedite/i);
  assert.match(help, /\/redeploy/i);
  assert.match(help, /\/pause/i);
  assert.match(help, /\/resume/i);
  assert.match(help, /\/stop/i);
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

test('cursor bridge: isCursorAuthError detects recoverable authentication failures', () => {
  assert.equal(
    isCursorAuthError(
      'Cursor run failed (run-f4100d8e): Authentication error If you are logged in, try logging out and back in.'
    ),
    true
  );
  assert.equal(isCursorAuthError('401 Unauthorized'), true);
  assert.equal(isCursorAuthError('network timeout'), false);
});

test('cursor bridge: isCursorConnectionFailure detects repeated connection failures', () => {
  assert.equal(isCursorConnectionFailure('Connection failed repeatedly after retries'), true);
  assert.equal(isCursorConnectionFailure('Telegram request failed: fetch failed'), true);
  assert.equal(isCursorConnectionFailure('Cursor run failed (run-123): [unavailable] Error'), true);
  assert.equal(isCursorConnectionFailure('quota exceeded'), false);
});

test('cursor bridge: shouldResetCursorAgentSession covers auth, active-run, and connection failures', () => {
  assert.equal(shouldResetCursorAgentSession('already has active run'), true);
  assert.equal(shouldResetCursorAgentSession('Authentication error'), true);
  assert.equal(shouldResetCursorAgentSession('Connection failed repeatedly after retries'), true);
  assert.equal(shouldResetCursorAgentSession('Cursor run failed (run-123): [unavailable] Error'), true);
  assert.equal(shouldResetCursorAgentSession('quota exceeded'), false);
});

test('cursor bridge: isCursorResourceExhausted detects rate-limit / quota errors', () => {
  assert.equal(isCursorResourceExhausted('[resource_exhausted] Error'), true);
  assert.equal(isCursorResourceExhausted('resource exhausted'), true);
  assert.equal(isCursorResourceExhausted('Rate limit exceeded'), true);
  assert.equal(isCursorResourceExhausted('Connection failed'), false);
  assert.equal(isCursorResourceExhausted('Authentication error'), false);
});

test('cursor bridge: resource-exhausted does not trigger session reset', () => {
  assert.equal(shouldResetCursorAgentSession('[resource_exhausted] Error'), false);
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

test('parseCursorBridgeCliArgs: --help / -h never treat help as a repo root', () => {
  assert.deepEqual(parseCursorBridgeCliArgs(['--help']), { kind: 'help' });
  assert.deepEqual(parseCursorBridgeCliArgs(['-h']), { kind: 'help' });
  assert.deepEqual(parseCursorBridgeCliArgs(['--help', '/tmp/repo']), { kind: 'help' });
  assert.deepEqual(parseCursorBridgeCliArgs(['/tmp/repo', '-h']), { kind: 'help' });
});

test('parseCursorBridgeCliArgs: first positional is repo root; empty falls back to caller cwd', () => {
  assert.deepEqual(parseCursorBridgeCliArgs(['/tmp/swarm']), { kind: 'run', repoRootArg: '/tmp/swarm' });
  assert.deepEqual(parseCursorBridgeCliArgs([]), { kind: 'run', repoRootArg: undefined });
});

test('parseCursorBridgeCliArgs: skips a blank leading arg to find the real positional', () => {
  assert.deepEqual(parseCursorBridgeCliArgs(['', '/tmp/swarm']), { kind: 'run', repoRootArg: '/tmp/swarm' });
});

test('parseCursorBridgeCliArgs: a nullish argv tail falls back to no positional, never a stray sentinel', () => {
  assert.deepEqual(parseCursorBridgeCliArgs(undefined), { kind: 'run', repoRootArg: undefined });
});

test('parseCursorBridgeCliArgs: skips a non-help flag to find the positional after it', () => {
  assert.deepEqual(parseCursorBridgeCliArgs(['--verbose', '/tmp/swarm']), {
    kind: 'run',
    repoRootArg: '/tmp/swarm',
  });
  // A lone unrecognized flag with no positional after it never matches the
  // find predicate — falls back to undefined (caller cwd), not the flag text.
  assert.deepEqual(parseCursorBridgeCliArgs(['--verbose']), { kind: 'run', repoRootArg: undefined });
});

test('CURSOR_BRIDGE_CLI_USAGE documents the CLI invocation and shared-token queue behavior', () => {
  assert.equal(
    CURSOR_BRIDGE_CLI_USAGE,
    'Usage: node telegram-cursor-bridge.js <repo-root>\n' +
      "Telegram ↔ Cursor SDK remote control. Prefer start_cursor_bridge.sh.\n" +
      'Shared TELEGRAM_BOT_TOKEN with front desk: drains inbound queue (no getUpdates).\n'
  );
});

test('shouldUseCursorBridgeInboundQueue: shared token defaults to queue (never steal getUpdates)', () => {
  assert.equal(shouldUseCursorBridgeInboundQueue({}), true);
  assert.equal(shouldUseCursorBridgeInboundQueue({ TELEGRAM_BOT_TOKEN: 'shared' }), true);
  assert.equal(shouldUseCursorBridgeInboundQueue({ CURSOR_BRIDGE_INBOUND_QUEUE: '1' }), true);
});

test('shouldUseCursorBridgeInboundQueue: exclusive CURSOR_BRIDGE_BOT_TOKEN owns getUpdates unless forced', () => {
  assert.equal(shouldUseCursorBridgeInboundQueue({ CURSOR_BRIDGE_BOT_TOKEN: 'exclusive' }), false);
  assert.equal(
    shouldUseCursorBridgeInboundQueue({
      CURSOR_BRIDGE_BOT_TOKEN: 'exclusive',
      CURSOR_BRIDGE_INBOUND_QUEUE: '1',
    }),
    true
  );
  assert.equal(shouldUseCursorBridgeInboundQueue({ CURSOR_BRIDGE_INBOUND_QUEUE: '0' }), false);
});

test('shouldUseCursorBridgeInboundQueue: whitespace-only env values trim to their empty/absent behavior', () => {
  // A whitespace-only flag is neither '1' nor '0' — falls through to the
  // exclusive-token default, same as the flag being unset entirely.
  assert.equal(shouldUseCursorBridgeInboundQueue({ CURSOR_BRIDGE_INBOUND_QUEUE: '  ' }), true);
  assert.equal(
    shouldUseCursorBridgeInboundQueue({ CURSOR_BRIDGE_INBOUND_QUEUE: '  ', CURSOR_BRIDGE_BOT_TOKEN: 'excl' }),
    false
  );
  // A whitespace-only bot token trims to empty (falsy) — must not count as
  // "exclusive token configured".
  assert.equal(shouldUseCursorBridgeInboundQueue({ CURSOR_BRIDGE_BOT_TOKEN: '   ' }), true);
});

test('shouldUseCursorBridgeInboundQueue: a padded flag value is trimmed before comparing, not compared raw', () => {
  // '1' padded with whitespace only reads as forced-on once trimmed. Paired
  // with an exclusive bot token (which alone would answer false), this only
  // stays true if the raw ' 1 ' is actually trimmed to '1' before the
  // comparison — if the .trim() call were dropped, ' 1 ' would never equal
  // '1' and this would fall through to the (here, false) token default.
  assert.equal(
    shouldUseCursorBridgeInboundQueue({ CURSOR_BRIDGE_INBOUND_QUEUE: ' 1 ', CURSOR_BRIDGE_BOT_TOKEN: 'excl' }),
    true
  );
  assert.equal(shouldUseCursorBridgeInboundQueue({ CURSOR_BRIDGE_INBOUND_QUEUE: ' 0 ' }), false);
});

test('cursor bridge: BUBBLE_TOPIC_NAME is the standing Bubble topic title', () => {
  assert.equal(BUBBLE_TOPIC_NAME, 'Bubble');
});

test('decideEnsureBubbleTopicAction: reuses an existing BUBBLE binding by its exact topic id', () => {
  assert.deepEqual(decideEnsureBubbleTopicAction({ '55': 'BUBBLE', '56': 'CURSOR_REMOTE' }), {
    kind: 'reuse',
    topicId: 55,
  });
});

test('decideEnsureBubbleTopicAction: creates when no BUBBLE binding exists', () => {
  assert.deepEqual(decideEnsureBubbleTopicAction({ '56': 'CURSOR_REMOTE' }), { kind: 'create' });
  assert.deepEqual(decideEnsureBubbleTopicAction({}), { kind: 'create' });
});

test('normalizeCursorBridgeTopicScope: undefined and null both normalize to an empty scope', () => {
  assert.deepEqual(normalizeCursorBridgeTopicScope(undefined), {});
  assert.deepEqual(normalizeCursorBridgeTopicScope(null), {});
  assert.deepEqual(Object.keys(normalizeCursorBridgeTopicScope(null)), []);
});

test('normalizeCursorBridgeTopicScope: a bare number is treated as the cursor topic id only', () => {
  assert.deepEqual(normalizeCursorBridgeTopicScope(7501), { cursorTopicId: 7501 });
});

test('normalizeCursorBridgeTopicScope: keeps only numeric fields, dropping non-number ids entirely (no key, not just undefined)', () => {
  const scope = normalizeCursorBridgeTopicScope({ cursorTopicId: 'nope', bubbleTopicId: 55 });
  assert.deepEqual(scope, { bubbleTopicId: 55 });
  assert.equal('cursorTopicId' in scope, false);
});

test('normalizeCursorBridgeTopicScope: an empty object normalizes to an empty scope (no keys at all)', () => {
  assert.deepEqual(Object.keys(normalizeCursorBridgeTopicScope({})), []);
});

test('isOwnedCursorBridgeTopic: matches either the cursor or bubble topic id, and only those', () => {
  const topics = { cursorTopicId: 7501, bubbleTopicId: 55 };
  assert.equal(isOwnedCursorBridgeTopic(7501, topics), true);
  assert.equal(isOwnedCursorBridgeTopic(55, topics), true);
  assert.equal(isOwnedCursorBridgeTopic(999, topics), false);
  assert.equal(isOwnedCursorBridgeTopic(undefined, topics), false);
});
