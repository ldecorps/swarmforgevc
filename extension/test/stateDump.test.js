const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  writeStateDump,
  readStateDump,
  readPreviousStateDump,
  startPeriodicStateDump,
} = require('../out/swarm/stateDump');

function mkTmpSwarmforgeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'state-dump-'));
}

function snapshot(overrides) {
  return {
    timestamp: '2026-07-06T10:00:00.000Z',
    target: '/repo',
    attachState: 'attached',
    launchState: 'ready',
    swarmInfo: { liveness: {}, stageHolder: null, roles: [] },
    reason: null,
    ...overrides,
  };
}

test('state-dump-01: writeStateDump persists a snapshot readable via readStateDump', () => {
  const dir = mkTmpSwarmforgeDir();
  writeStateDump(dir, snapshot({ reason: 'deactivate' }));

  const read = readStateDump(dir);
  assert.equal(read.reason, 'deactivate');
  assert.equal(read.target, '/repo');
});

test('readStateDump returns undefined when no dump has ever been written', () => {
  const dir = mkTmpSwarmforgeDir();
  assert.equal(readStateDump(dir), undefined);
});

test('readStateDump returns undefined for a corrupt dump file rather than throwing', () => {
  const dir = mkTmpSwarmforgeDir();
  fs.mkdirSync(path.join(dir, 'dumps'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dumps', 'extension-state.json'), 'not json{{{');
  assert.equal(readStateDump(dir), undefined);
});

test('state-dump-04: a second write rotates the prior snapshot into the previous slot instead of clobbering it', () => {
  const dir = mkTmpSwarmforgeDir();
  writeStateDump(dir, snapshot({ reason: null, timestamp: 't1' }));
  writeStateDump(dir, snapshot({ reason: 'crash', timestamp: 't2' }));

  assert.equal(readStateDump(dir).timestamp, 't2');
  assert.equal(readPreviousStateDump(dir).timestamp, 't1');
});

test('readPreviousStateDump returns undefined when only one dump has ever been written', () => {
  const dir = mkTmpSwarmforgeDir();
  writeStateDump(dir, snapshot());
  assert.equal(readPreviousStateDump(dir), undefined);
});

test('writeStateDump never throws even when the swarmforge dir path is unwritable', () => {
  const dir = mkTmpSwarmforgeDir();
  const unwritable = path.join(dir, 'dumps');
  fs.mkdirSync(unwritable, { recursive: true });
  fs.writeFileSync(path.join(unwritable, 'extension-state.json'), 'x');
  // Make the dumps dir itself a file's sibling with a bogus nested path to
  // force a real fs error (a file where a directory is expected).
  const bogusRoot = path.join(dir, 'blocked-file');
  fs.writeFileSync(bogusRoot, 'im a file, not a directory');

  assert.doesNotThrow(() => writeStateDump(bogusRoot, snapshot()));
});

test('state-dump-02: startPeriodicStateDump writes a snapshot on the injected scheduler tick', () => {
  const dir = mkTmpSwarmforgeDir();
  let tick;
  const stop = startPeriodicStateDump(
    dir,
    () => snapshot({ reason: null, timestamp: 'periodic-1' }),
    1000,
    (fn) => { tick = fn; return 'handle'; },
    () => {}
  );

  assert.equal(readStateDump(dir), undefined, 'no snapshot yet before the first tick fires');

  tick();

  assert.equal(readStateDump(dir).timestamp, 'periodic-1');
  stop();
});

test('state-dump-02: startPeriodicStateDump clears the underlying interval when stopped', () => {
  const dir = mkTmpSwarmforgeDir();
  const cleared = [];
  const stop = startPeriodicStateDump(
    dir,
    () => snapshot(),
    1000,
    () => 'the-handle',
    (handle) => cleared.push(handle)
  );

  stop();

  assert.deepEqual(cleared, ['the-handle']);
});
