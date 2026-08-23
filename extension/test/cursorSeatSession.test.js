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
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  signalFromRunResult,
  signalFromStreamEvent,
  transcriptLineFromStreamEvent,
  readHeadShortCommit,
  sendTaskToLiveSession,
} = require('../out/swarm/cursorSeatSession');

// A fake SDK agent run: `stream()` yields the given events, `wait()` resolves
// to the given result — the only two calls sendTaskToLiveSession makes on
// whatever `session.agent.send(...)` returns. No real Cursor SDK involved.
function fakeSession(streamEvents, waitResult) {
  return {
    cwd: '/fake/worktree',
    agent: {
      send: async () => ({
        stream: async function* () {
          for (const event of streamEvents) yield event;
        },
        wait: async () => waitResult,
      }),
    },
  };
}

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

test('an assistant transcript line joins the message content and collapses whitespace', () => {
  const line = transcriptLineFromStreamEvent({
    type: 'assistant',
    message: { content: [{ text: 'all  done,' }, { type: 'other' }, { text: 'forwarding' }] },
  });
  assert.equal(line, 'assistant: all done, forwarding');
});

test('an assistant event with no real text yields no transcript line', () => {
  assert.equal(transcriptLineFromStreamEvent({ type: 'assistant', message: { content: [] } }), undefined);
  assert.equal(transcriptLineFromStreamEvent({ type: 'assistant', message: { content: [{ text: '   ' }] } }), undefined);
  assert.equal(transcriptLineFromStreamEvent({ type: 'assistant' }), undefined);
});

test('a falsy event yields no transcript line', () => {
  assert.equal(transcriptLineFromStreamEvent(undefined), undefined);
});

// ── readHeadShortCommit (a real subprocess adapter, no CURSOR_API_KEY needed) ──

test('readHeadShortCommit reads this checkout\'s own real HEAD as a 10-hex short sha', () => {
  const sha = readHeadShortCommit(path.join(__dirname, '..'));
  assert.match(sha, /^[0-9a-f]{10}$/);
});

test('readHeadShortCommit returns undefined for a cwd that is not a git checkout at all', () => {
  const notARepo = mkTmpDir('sfvc-bl713-notrepo-');
  assert.equal(readHeadShortCommit(notARepo), undefined);
});

// ── sendTaskToLiveSession (the SDK adapter, driven through injected session +
// readHeadCommit — no real Cursor account needed; the only two calls this
// function makes on `session.agent.send(...)`'s return are `stream()` and
// `wait()`, both faked above) ───────────────────────────────────────────────

test('a completed run with a real commit reports the stop signal and the committed work', async () => {
  const session = fakeSession(
    [{ type: 'assistant', message: { content: [{ text: 'done' }] } }],
    { status: 'completed' }
  );
  let calls = 0;
  const readHeadCommit = (cwd) => {
    assert.equal(cwd, '/fake/worktree');
    calls += 1;
    return calls === 1 ? 'aaaaaaaaaa' : 'bbbbbbbbbb';
  };
  const result = await sendTaskToLiveSession(session, 'documenter', { taskName: 'BL-1', file: 'x', from: 'a', type: 'git_handoff', priority: '00' }, readHeadCommit);
  assert.deepEqual(result.signal, { kind: 'stop_reason', value: 'completed' });
  assert.equal(result.work.task, 'BL-1');
  assert.equal(result.work.commit, 'bbbbbbbbbb');
  assert.match(result.transcript.join('\n'), /done/);
});

test('a completed run with NO new commit reports undefined work, not a stale one', async () => {
  const session = fakeSession([], { status: 'completed' });
  const readHeadCommit = () => 'aaaaaaaaaa'; // same before and after — nothing was committed
  const result = await sendTaskToLiveSession(session, 'documenter', { taskName: 'BL-1', file: 'x', from: 'a', type: 'git_handoff', priority: '00' }, readHeadCommit);
  assert.equal(result.work.commit, undefined);
});

test('a tool denial mid-stream is the reported signal even when the run itself later completes', async () => {
  const session = fakeSession(
    [{ type: 'tool_call', name: 'edit_file', status: 'error' }],
    { status: 'completed' }
  );
  const result = await sendTaskToLiveSession(session, 'documenter', { taskName: 'BL-1', file: 'x', from: 'a', type: 'git_handoff', priority: '00' }, () => undefined);
  assert.deepEqual(result.signal, { kind: 'tool_event', tool: 'edit_file', permission: 'denied' });
});

test('an errored run with no tool denial reports the error stop signal', async () => {
  const session = fakeSession([], { status: 'failed', error: { message: 'session crashed' } });
  const result = await sendTaskToLiveSession(session, 'documenter', { taskName: 'BL-1', file: 'x', from: 'a', type: 'git_handoff', priority: '00' }, () => undefined);
  assert.deepEqual(result.signal, { kind: 'stop_reason', value: 'error', detail: 'session crashed' });
});
