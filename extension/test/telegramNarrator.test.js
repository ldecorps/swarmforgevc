const assert = require('node:assert/strict');
const { diffNarrationEvents, TelegramNarrator } = require('../out/notify/telegramNarrator');

const NOW = Date.parse('2026-07-10T12:00:00Z');

function snapshot(overrides = {}) {
  return {
    runName: 'swarm-1',
    prUrl: null,
    pipeline: [],
    gates: [],
    deadLetters: [],
    ...overrides,
  };
}

// ── diffNarrationEvents (pure) ──────────────────────────────────────────

test('diffNarrationEvents emits nothing for a run never narrated before with an empty snapshot', () => {
  assert.deepEqual(diffNarrationEvents(null, snapshot()), []);
});

test('BL-239 per-run-thread-narrates-01: a stage transition, a gate, a dead-letter, and a PR link are each one event', () => {
  const prev = snapshot({
    pipeline: [{ role: 'coder', status: 'active' }],
    gates: [{ role: 'coder', gated: false }],
    deadLetters: [],
  });
  const curr = snapshot({
    pipeline: [{ role: 'coder', status: 'idle' }],
    gates: [{ role: 'coder', gated: true, snippet: 'Allow? (y/n)' }],
    deadLetters: [{ role: 'cleaner', filePath: '/x/y.handoff.dead', chaseCount: 3 }],
    prUrl: 'https://example.com/pr/1',
  });

  const events = diffNarrationEvents(prev, curr);

  assert.deepEqual(events, [
    { kind: 'stage-transition', text: 'coder: active -> idle' },
    { kind: 'gate', text: 'coder needs you: Allow? (y/n)', role: 'coder' },
    { kind: 'dead-letter', text: 'dead-letter for cleaner' },
    { kind: 'pr-link', text: 'PR ready: https://example.com/pr/1' },
  ]);
});

test('diffNarrationEvents never re-emits a gate that was already gated last snapshot', () => {
  const prev = snapshot({ gates: [{ role: 'coder', gated: true, snippet: 'still waiting' }] });
  const curr = snapshot({ gates: [{ role: 'coder', gated: true, snippet: 'still waiting' }] });

  assert.deepEqual(diffNarrationEvents(prev, curr), []);
});

test('diffNarrationEvents never re-emits a PR link already narrated', () => {
  const prev = snapshot({ prUrl: 'https://example.com/pr/1' });
  const curr = snapshot({ prUrl: 'https://example.com/pr/1' });

  assert.deepEqual(diffNarrationEvents(prev, curr), []);
});

test('diffNarrationEvents never emits a stage transition for a role appearing for the first time', () => {
  const prev = snapshot({ pipeline: [] });
  const curr = snapshot({ pipeline: [{ role: 'coder', status: 'active' }] });

  assert.deepEqual(diffNarrationEvents(prev, curr), []);
});

test('diffNarrationEvents never re-emits a dead-letter already narrated', () => {
  const dl = { role: 'cleaner', filePath: '/x/y.handoff.dead', chaseCount: 3 };
  const prev = snapshot({ deadLetters: [dl] });
  const curr = snapshot({ deadLetters: [{ ...dl, chaseCount: 4 }] });

  assert.deepEqual(diffNarrationEvents(prev, curr), []);
});

// ── TelegramNarrator (adapters injected - no real network/timers) ──────────

function mkAdapters(overrides = {}) {
  const sent = [];
  const results = [];
  return {
    sent,
    results,
    adapters: {
      sendOnce: async (text, replyToMessageId) => {
        const messageId = sent.length + 1;
        sent.push({ text, replyToMessageId, messageId });
        return { success: true, messageId };
      },
      onSendResult: (event, result) => results.push({ event, result }),
      wait: async () => {},
      ...overrides,
    },
  };
}

const RETRY_CONFIG = { maxAttempts: 3, backoffBaseMs: 10, backoffMaxMs: 40 };

test('a first event for a run is posted with no reply target and becomes the thread root', async () => {
  const { sent, adapters } = mkAdapters();
  const narrator = new TelegramNarrator(RETRY_CONFIG, adapters);

  await narrator.sweep(snapshot({ pipeline: [{ role: 'coder', status: 'active' }] }), NOW);
  await narrator.sweep(snapshot({ pipeline: [{ role: 'coder', status: 'idle' }] }), NOW + 1000);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, 'coder: active -> idle');
  assert.equal(sent[0].replyToMessageId, undefined, 'the first message in a run thread has no reply target');
});

test('every later event for the same run replies into that run thread root', async () => {
  const { sent, adapters } = mkAdapters();
  const narrator = new TelegramNarrator(RETRY_CONFIG, adapters);

  await narrator.sweep(snapshot({ pipeline: [{ role: 'coder', status: 'active' }] }), NOW);
  await narrator.sweep(snapshot({ pipeline: [{ role: 'coder', status: 'idle' }] }), NOW + 1000);
  await narrator.sweep(
    snapshot({ pipeline: [{ role: 'coder', status: 'idle' }], prUrl: 'https://example.com/pr/1' }),
    NOW + 2000
  );

  assert.equal(sent.length, 2);
  const rootId = sent[0].messageId;
  assert.equal(sent[1].replyToMessageId, rootId, 'the second narrated event must reply into the first message');
});

test('two different runs get two independent thread roots, never cross-posted', async () => {
  const { sent, adapters } = mkAdapters();
  const narrator = new TelegramNarrator(RETRY_CONFIG, adapters);

  await narrator.sweep(snapshot({ runName: 'run-a', pipeline: [{ role: 'coder', status: 'active' }] }), NOW);
  await narrator.sweep(snapshot({ runName: 'run-b', pipeline: [{ role: 'coder', status: 'active' }] }), NOW);
  await narrator.sweep(snapshot({ runName: 'run-a', pipeline: [{ role: 'coder', status: 'idle' }] }), NOW + 1000);
  await narrator.sweep(snapshot({ runName: 'run-b', pipeline: [{ role: 'coder', status: 'idle' }] }), NOW + 1000);

  assert.equal(sent.length, 2);
  assert.equal(sent[0].replyToMessageId, undefined);
  assert.equal(sent[1].replyToMessageId, undefined, 'run-b is a separate thread, not a reply into run-a');
});

test('a gate event carries its role so the caller can register it as a pending gate prompt', async () => {
  const { results, adapters } = mkAdapters();
  const narrator = new TelegramNarrator(RETRY_CONFIG, adapters);

  await narrator.sweep(snapshot({ gates: [{ role: 'coder', gated: false }] }), NOW);
  await narrator.sweep(snapshot({ gates: [{ role: 'coder', gated: true, snippet: 'Allow? (y/n)' }] }), NOW + 1000);

  assert.equal(results.length, 1);
  assert.equal(results[0].event.kind, 'gate');
  assert.equal(results[0].event.role, 'coder');
  assert.equal(results[0].result.success, true);
  assert.equal(typeof results[0].result.messageId, 'number');
});

test('a send that fails every bounded-retry attempt escalates (onSendResult reports failure) without crashing the sweep', async () => {
  const { results, adapters } = mkAdapters({
    sendOnce: async () => ({ success: false, error: 'Telegram is down' }),
  });
  const narrator = new TelegramNarrator(RETRY_CONFIG, adapters);

  await narrator.sweep(snapshot({ pipeline: [{ role: 'coder', status: 'active' }] }), NOW);
  await narrator.sweep(snapshot({ pipeline: [{ role: 'coder', status: 'idle' }] }), NOW + 1000);

  assert.equal(results.length, 1);
  assert.equal(results[0].result.success, false);
  assert.equal(results[0].result.attempts, RETRY_CONFIG.maxAttempts);
  assert.equal(results[0].result.error, 'Telegram is down');
});

test('a permanently-failed thread-root send never gets treated as a thread root for the next event', async () => {
  let callCount = 0;
  const { sent, adapters } = mkAdapters({
    sendOnce: async (text, replyToMessageId) => {
      callCount++;
      if (callCount <= RETRY_CONFIG.maxAttempts) {
        return { success: false, error: 'down' };
      }
      const messageId = sent.length + 1;
      sent.push({ text, replyToMessageId, messageId });
      return { success: true, messageId };
    },
  });
  const narrator = new TelegramNarrator(RETRY_CONFIG, adapters);

  // First narrated event fails outright (all retries exhausted).
  await narrator.sweep(snapshot({ pipeline: [{ role: 'coder', status: 'active' }] }), NOW);
  await narrator.sweep(snapshot({ pipeline: [{ role: 'coder', status: 'idle' }] }), NOW + 1000);
  // Second narrated event succeeds - it must become the thread root since
  // the first one never actually posted anything to reply into.
  await narrator.sweep(snapshot({ pipeline: [{ role: 'coder', status: 'active' }] }), NOW + 2000);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].replyToMessageId, undefined, 'the first SUCCESSFULLY posted message becomes the thread root');
});
