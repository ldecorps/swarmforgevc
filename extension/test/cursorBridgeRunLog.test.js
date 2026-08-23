'use strict';

// BL-1050: the Cursor Remote bridge records its run failures on this host.
//
// The supervisor already redirects the bridge's stdout and stderr into
// .swarmforge/operator/cursor-bridge.log; the bridge simply never printed. So
// this module is only two things: the LINE (structured, greppable, carrying
// nothing it must not carry) and the SINK (stderr by default, injectable so a
// test never depends on a real file).
//
// Both invariants are enforced here rather than by review:
//   - a failure surfaced to a human is also written to disk: the line is
//     emitted at the point that DECIDES the failure, before the throw the
//     Telegram poster catches, so the record cannot depend on the post.
//   - no secret and no conversation content is logged: the line is built from
//     exactly three fields, and any value of a secret-looking environment
//     variable that appears in the reason is redacted out.

const assert = require('node:assert/strict');

const {
  CURSOR_PROGRESS_POST_FAILURE_MARKER,
  CURSOR_RUN_FAILURE_MARKER,
  formatCursorRunFailureLine,
  redactEnvironmentSecrets,
  secretEnvironmentValues,
  logCursorRunFailure,
  logProgressPostFailure,
} = require('../out/bridge/cursorBridgeRunLog');

const AT = '2026-08-22T23:00:00.000Z';

// ── the line ──────────────────────────────────────────────────────────────

test('a failure line names the run id, the reset decision and the reason', () => {
  const line = formatCursorRunFailureLine({
    at: AT,
    runId: 'run-abc123',
    reason: 'Connection failed repeatedly',
    reset: true,
  });
  assert.equal(
    line,
    '2026-08-22T23:00:00.000Z cursor-bridge run failed run=run-abc123 reset=yes reason=Connection failed repeatedly'
  );
});

test('the line carries a stable marker a grep can anchor on', () => {
  const line = formatCursorRunFailureLine({ at: AT, runId: 'r', reason: 'boom', reset: false });
  assert.equal(CURSOR_RUN_FAILURE_MARKER, 'cursor-bridge run failed');
  assert.ok(line.includes(CURSOR_RUN_FAILURE_MARKER));
});

test('a run the bridge did not reset says so explicitly, never by omission', () => {
  const line = formatCursorRunFailureLine({ at: AT, runId: 'r', reason: 'resource_exhausted', reset: false });
  assert.match(line, /reset=no/);
});

test('a missing run id or reason is named as unknown rather than left blank', () => {
  const line = formatCursorRunFailureLine({ at: AT, runId: '', reason: '', reset: false });
  assert.match(line, /run=unknown/);
  assert.match(line, /reason=unknown/);
});

test('a multi-line reason is collapsed so one event is one greppable line', () => {
  const line = formatCursorRunFailureLine({
    at: AT,
    runId: 'r',
    reason: 'first line\nsecond line\r\nthird',
    reset: false,
  });
  assert.equal(line.split('\n').length, 1);
  assert.match(line, /first line second line third/);
});

// ── redaction (invariant 2) ───────────────────────────────────────────────

test('a secret-looking environment variable contributes its value to the redaction set', () => {
  const values = secretEnvironmentValues({
    CURSOR_API_KEY: 'sk-cursor-abcdefgh',
    TELEGRAM_BOT_TOKEN: '12345:AAsecrettoken',
    SOME_SECRET: 'shhhhhhhh',
    DB_PASSWORD: 'hunter2hunter2',
    PATH: '/usr/bin:/bin',
    HOME: '/home/someone',
  });
  assert.deepEqual(
    [...values].sort(),
    ['12345:AAsecrettoken', 'hunter2hunter2', 'shhhhhhhh', 'sk-cursor-abcdefgh'].sort()
  );
});

test('a short or empty secret value is not redacted, since it would blank ordinary words', () => {
  const values = secretEnvironmentValues({ A_KEY: 'no', B_TOKEN: '', C_SECRET: '   ' });
  assert.deepEqual([...values], []);
});

test('a value of a secret-looking variable never survives into the line', () => {
  const env = { CURSOR_API_KEY: 'sk-cursor-abcdefgh', TELEGRAM_BOT_TOKEN: '12345:AAsecrettoken' };
  const reason = redactEnvironmentSecrets('auth failed for sk-cursor-abcdefgh via 12345:AAsecrettoken', env);
  assert.equal(reason, 'auth failed for [redacted] via [redacted]');
  // Asserted by NAME and by absence - never by printing the value itself.
  for (const name of Object.keys(env)) {
    assert.ok(!reason.includes(env[name]), `${name}'s value reached the line`);
  }
});

test('redaction leaves an ordinary reason untouched', () => {
  assert.equal(
    redactEnvironmentSecrets('Connection failed repeatedly', { CURSOR_API_KEY: 'sk-cursor-abcdefgh' }),
    'Connection failed repeatedly'
  );
});

// ── the sink ──────────────────────────────────────────────────────────────

test('the failure is written to the injected sink and the written line returned', () => {
  const written = [];
  const line = logCursorRunFailure(
    { runId: 'run-1', reason: 'Connection failed repeatedly', reset: true },
    { sink: (l) => written.push(l), now: () => AT, env: {} }
  );
  assert.deepEqual(written, [line]);
  assert.match(line, /run=run-1/);
  assert.match(line, /reset=yes/);
});

test('the reason is redacted on the way to the sink, not merely on the way back', () => {
  const written = [];
  logCursorRunFailure(
    { runId: 'run-1', reason: 'bad key sk-cursor-abcdefgh', reset: false },
    { sink: (l) => written.push(l), now: () => AT, env: { CURSOR_API_KEY: 'sk-cursor-abcdefgh' } }
  );
  assert.equal(written.length, 1);
  assert.ok(!written[0].includes('sk-cursor-abcdefgh'));
  assert.match(written[0], /\[redacted\]/);
});

test('a sink that throws never becomes the failure the caller reports', () => {
  const line = logCursorRunFailure(
    { runId: 'run-1', reason: 'boom', reset: false },
    {
      sink: () => {
        throw new Error('log device full');
      },
      now: () => AT,
      env: {},
    }
  );
  assert.match(line, /run=run-1/);
});

test('nothing but the three fields can reach the line', () => {
  const line = logCursorRunFailure(
    { runId: 'run-1', reason: 'boom', reset: false, prompt: 'deploy the staging key', reply: 'ok' },
    { sink: () => {}, now: () => AT, env: {} }
  );
  assert.ok(!line.includes('deploy the staging key'));
  assert.ok(!line.includes('ok'));
});

// ── the progress-post failure line (architect send-back #1 follow-through) ─

test('a failed progress post is recorded under its OWN marker, never as a run failure', () => {
  const written = [];
  const line = logProgressPostFailure('telegram post failed', {
    sink: (l) => written.push(l),
    now: () => AT,
    env: {},
  });
  assert.deepEqual(written, [line]);
  assert.equal(CURSOR_PROGRESS_POST_FAILURE_MARKER, 'cursor-bridge progress post failed');
  assert.match(line, new RegExp(CURSOR_PROGRESS_POST_FAILURE_MARKER));
  assert.match(line, /reason=telegram post failed/);
  assert.ok(
    !line.includes(CURSOR_RUN_FAILURE_MARKER),
    "a failed post must not corrupt every grep for 'run failed'"
  );
});

test('the progress-post line says the run continues, because it does', () => {
  const line = logProgressPostFailure('boom', { sink: () => {}, now: () => AT, env: {} });
  assert.match(line, /run continues/);
});

test('a secret in a post failure is redacted exactly as it is in a run failure', () => {
  const written = [];
  logProgressPostFailure('rejected 12345:AAsecrettoken', {
    sink: (l) => written.push(l),
    now: () => AT,
    env: { TELEGRAM_BOT_TOKEN: '12345:AAsecrettoken' },
  });
  assert.ok(!written[0].includes('12345:AAsecrettoken'));
  assert.match(written[0], /\[redacted\]/);
});

test('a multi-line post failure collapses to one greppable line, and an empty one is named', () => {
  assert.equal(
    logProgressPostFailure('first\nsecond', { sink: () => {}, now: () => AT, env: {} }).split('\n').length,
    1
  );
  assert.match(logProgressPostFailure('', { sink: () => {}, now: () => AT, env: {} }), /reason=unknown/);
});

test('a sink that throws never becomes the failure the caller reports, here either', () => {
  const line = logProgressPostFailure('boom', {
    sink: () => {
      throw new Error('log device full');
    },
    now: () => AT,
    env: {},
  });
  assert.match(line, /reason=boom/);
});
