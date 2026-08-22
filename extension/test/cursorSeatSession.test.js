'use strict';

// BL-713: the Cursor SDK session adapter's SIGNAL MAPPING — the seam that
// turns SDK stream events and run results into the structured signals
// cursorSeatDriver decides on. Kept pure and separate from the live SDK boot
// so the mapping is unit-testable without a CURSOR_API_KEY, a network, or a
// real agent.
//
// The whole point of this file is invariant 2: if the mapping ever started
// deriving a signal from rendered text, these tests are where it would show.

const assert = require('node:assert/strict');

const {
  signalFromRunResult,
  signalFromStreamEvent,
  transcriptLineFromStreamEvent,
} = require('../out/swarm/cursorSeatSession');

// ── run results → stop reasons ────────────────────────────────────────────

test('a completed run reports a completed stop reason', () => {
  assert.deepEqual(signalFromRunResult({ status: 'completed' }), {
    kind: 'stop_reason',
    value: 'completed',
  });
});

test('an errored run reports an error stop reason carrying the SDK message', () => {
  const signal = signalFromRunResult({ status: 'error', error: { message: 'quota exhausted' } });
  assert.equal(signal.kind, 'stop_reason');
  assert.equal(signal.value, 'error');
  assert.match(signal.detail, /quota exhausted/);
});

test('an errored run with no message still reports an error, never a completion', () => {
  const signal = signalFromRunResult({ status: 'error' });
  assert.equal(signal.value, 'error');
  assert.match(signal.detail, /unknown/i);
});

test('a run status the adapter does not recognise is an error, never a completion', () => {
  for (const status of ['cancelled', 'expired', undefined, '', 'COMPLETED']) {
    const signal = signalFromRunResult({ status });
    assert.equal(signal.value, 'error', `status ${JSON.stringify(status)} must not read as completed`);
  }
});

// ── stream events → tool events ───────────────────────────────────────────

test('a completed tool call is a granted tool event naming the tool', () => {
  assert.deepEqual(signalFromStreamEvent({ type: 'tool_call', name: 'shell', status: 'completed' }), {
    kind: 'tool_event',
    tool: 'shell',
    permission: 'granted',
  });
});

test('an errored tool call is a denied tool event', () => {
  assert.deepEqual(signalFromStreamEvent({ type: 'tool_call', name: 'shell', status: 'error' }), {
    kind: 'tool_event',
    tool: 'shell',
    permission: 'denied',
  });
});

test('a running tool call is not yet a decision point', () => {
  assert.equal(signalFromStreamEvent({ type: 'tool_call', name: 'shell', status: 'running' }), undefined);
});

test('assistant prose yields no signal at all — text never drives a decision', () => {
  assert.equal(signalFromStreamEvent({ type: 'assistant', message: { content: [{ text: 'all done, forwarding' }] } }), undefined);
  assert.equal(signalFromStreamEvent({ type: 'thinking', text: 'I think the work is completed' }), undefined);
  assert.equal(signalFromStreamEvent({ type: 'status', status: 'RUNNING', message: 'completed' }), undefined);
});

// ── stream events → transcript lines (an OUTPUT, for the human) ───────────

test('a transcript line records what the session did, without becoming a signal', () => {
  assert.match(transcriptLineFromStreamEvent({ type: 'tool_call', name: 'shell', status: 'completed' }), /shell/);
  assert.match(transcriptLineFromStreamEvent({ type: 'thinking', text: 'considering' }), /considering/);
  assert.equal(transcriptLineFromStreamEvent({ type: 'status', status: 'CREATING' }), undefined);
});
