const assert = require('node:assert/strict');
const { parseArgs, USAGE } = require('../out/tools/closingCeremonyRunArgs');

// BL-820: closing-ceremony-run.js's flag parsing - both flags are optional
// (a bare run resolves --target via git and --at via the real clock; tests
// always inject both).

test('parseArgs accepts no flags at all', () => {
  assert.deepEqual(parseArgs([]), {});
});

test('parseArgs accepts --target and --at together', () => {
  assert.deepEqual(parseArgs(['--target', '/tmp/x', '--at', '2026-08-08T22:00:00.000Z']), { target: '/tmp/x', at: '2026-08-08T22:00:00.000Z' });
});

test('parseArgs rejects an unknown flag', () => {
  assert.equal(parseArgs(['--bogus', 'x']), null);
});

test('USAGE mentions both optional flags', () => {
  assert.ok(USAGE.includes('--target'));
  assert.ok(USAGE.includes('--at'));
});
