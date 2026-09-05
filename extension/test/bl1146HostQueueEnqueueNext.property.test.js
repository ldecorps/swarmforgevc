'use strict';

const assert = require('node:assert/strict');
const {
  clearEnqueueNextIfStale,
  decideIdleQueueTransition,
  formatEnqueueNextAckMessage,
  hostReplyTextIsQuestion,
} = require('../out/tools/telegramCursorBridgeCore');

function mkPrompt(id, text) {
  return { id, text, createdAtMs: Date.now() };
}

test('hostReplyTextIsQuestion detects trailing question mark', () => {
  assert.equal(hostReplyTextIsQuestion('All done.'), false);
  assert.equal(hostReplyTextIsQuestion('Which option?'), true);
  assert.equal(hostReplyTextIsQuestion('line one\nline two?'), true);
});

test('decideIdleQueueTransition auto-starts valid pin when host reply is not a question', () => {
  const pending = [mkPrompt('q1', 'first'), mkPrompt('q2', 'second')];
  const out = decideIdleQueueTransition({
    pendingPrompts: pending,
    enqueueNextPromptId: 'q1',
    hostFinishingReplyIsQuestion: false,
  });
  assert.deepEqual(out, { kind: 'auto-start', itemId: 'q1' });
});

test('decideIdleQueueTransition holds pin when host reply is a question', () => {
  const pending = [mkPrompt('q1', 'first'), mkPrompt('q2', 'second')];
  const out = decideIdleQueueTransition({
    pendingPrompts: pending,
    enqueueNextPromptId: 'q1',
    hostFinishingReplyIsQuestion: true,
  });
  assert.deepEqual(out, { kind: 'hold-pin' });
});

test('decideIdleQueueTransition posts choose-next poll when idle without pin', () => {
  const pending = [mkPrompt('q1', 'first'), mkPrompt('q2', 'second')];
  const out = decideIdleQueueTransition({
    pendingPrompts: pending,
    enqueueNextPromptId: undefined,
    hostFinishingReplyIsQuestion: false,
  });
  assert.deepEqual(out, { kind: 'post-choose-next-poll' });
});

test('decideIdleQueueTransition clears stale pin then polls when pin id is gone', () => {
  const pending = [mkPrompt('q2', 'second')];
  const out = decideIdleQueueTransition({
    pendingPrompts: pending,
    enqueueNextPromptId: 'gone',
    hostFinishingReplyIsQuestion: false,
  });
  assert.deepEqual(out, { kind: 'clear-stale-pin-then-poll' });
});

test('clearEnqueueNextIfStale drops pin when id is gone', () => {
  const state = {
    updateOffset: 0,
    enqueueNextPromptId: 'gone',
    pendingPrompts: [mkPrompt('q2', 'second')],
  };
  const next = clearEnqueueNextIfStale(state);
  assert.equal(next.enqueueNextPromptId, undefined);
});

test('formatEnqueueNextAckMessage matches locked ack copy', () => {
  assert.equal(
    formatEnqueueNextAckMessage('1) first question'),
    'Enqueued next: 1) first question. Will start when idle.'
  );
});
