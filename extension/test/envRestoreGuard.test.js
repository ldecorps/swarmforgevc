'use strict';

const assert = require('node:assert/strict');
const { snapshotEnv, diffEnvSnapshots, formatEnvLeakMessage } = require('./helpers/envRestoreGuard');

// BL-720: unit tests for the pure snapshot/diff/format logic the runtime
// guard (envRestoreGuardSetup.js) wraps. No real process.env mutation here -
// fixture objects only, same split as rawMkdtempGuard.js's pure
// findRawMkdtempLines vs its impure findRawMkdtempCallSites.

// ── diffEnvSnapshots (pure) ─────────────────────────────────────────────

test('reports no leaks when before and after are identical', () => {
  const snap = { FOO: 'bar', BAZ: 'qux' };
  assert.deepEqual(diffEnvSnapshots(snap, { ...snap }), []);
});

test('reports a leak when a key holding a value was deleted', () => {
  const before = { FOO: 'bar', CURSOR_API_KEY: 'ambient-value' };
  const after = { FOO: 'bar' };
  assert.deepEqual(diffEnvSnapshots(before, after), [{ key: 'CURSOR_API_KEY', before: 'ambient-value', after: undefined }]);
});

test('reports a leak when a key that was absent got added and left set', () => {
  const before = { FOO: 'bar' };
  const after = { FOO: 'bar', CURSOR_API_KEY: 'test-key' };
  assert.deepEqual(diffEnvSnapshots(before, after), [{ key: 'CURSOR_API_KEY', before: undefined, after: 'test-key' }]);
});

test('reports a leak when a key changed from one value to another', () => {
  const before = { CURSOR_API_KEY: 'real-value' };
  const after = { CURSOR_API_KEY: 'test-key' };
  assert.deepEqual(diffEnvSnapshots(before, after), [{ key: 'CURSOR_API_KEY', before: 'real-value', after: 'test-key' }]);
});

test('reports every leaked key, not just the first, sorted for a stable message', () => {
  const before = { ZKEY: 'z', AKEY: 'a' };
  const after = {};
  assert.deepEqual(diffEnvSnapshots(before, after), [
    { key: 'AKEY', before: 'a', after: undefined },
    { key: 'ZKEY', before: 'z', after: undefined },
  ]);
});

test('a key restored to exactly its prior value after a mutation is not a leak', () => {
  const before = { CURSOR_API_KEY: 'ambient-value' };
  const mutated = { CURSOR_API_KEY: 'test-key' };
  const restored = { CURSOR_API_KEY: 'ambient-value' };
  assert.deepEqual(diffEnvSnapshots(before, mutated).length > 0, true);
  assert.deepEqual(diffEnvSnapshots(before, restored), []);
});

// ── snapshotEnv (impure, real process.env) ──────────────────────────────

test('snapshotEnv captures a real process.env key and is independent of later mutation', () => {
  const prev = process.env.BL720_ENVGUARD_UNIT_PROBE;
  try {
    process.env.BL720_ENVGUARD_UNIT_PROBE = 'captured';
    const snap = snapshotEnv();
    assert.equal(snap.BL720_ENVGUARD_UNIT_PROBE, 'captured');
    delete process.env.BL720_ENVGUARD_UNIT_PROBE;
    assert.equal(snap.BL720_ENVGUARD_UNIT_PROBE, 'captured');
  } finally {
    if (prev === undefined) delete process.env.BL720_ENVGUARD_UNIT_PROBE;
    else process.env.BL720_ENVGUARD_UNIT_PROBE = prev;
  }
});

// ── formatEnvLeakMessage (pure) ──────────────────────────────────────────

test('names the offending file and every leaked key', () => {
  const leaks = [{ key: 'CURSOR_API_KEY', before: 'ambient-value', after: undefined }];
  const message = formatEnvLeakMessage('/repo/extension/test/example.test.js', 'some test name', leaks);
  assert.match(message, /example\.test\.js/);
  assert.match(message, /CURSOR_API_KEY/);
  assert.match(message, /some test name/);
});

test('names every leaked key when a test leaks more than one', () => {
  const leaks = [
    { key: 'AKEY', before: 'a', after: undefined },
    { key: 'BKEY', before: undefined, after: 'b' },
  ];
  const message = formatEnvLeakMessage('/repo/extension/test/example.test.js', 'multi leak', leaks);
  assert.match(message, /AKEY/);
  assert.match(message, /BKEY/);
});
