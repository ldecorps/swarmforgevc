const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadRuns, appendRun } = require('../out/runs/runLog');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-runs-'));
}

test('loadRuns returns empty array when file does not exist', () => {
  const logPath = path.join(mkTmp(), 'runs.json');
  assert.deepEqual(loadRuns(logPath), []);
});

test('loadRuns returns empty array for malformed JSON', () => {
  const logPath = path.join(mkTmp(), 'runs.json');
  fs.writeFileSync(logPath, 'not-json');
  assert.deepEqual(loadRuns(logPath), []);
});

test('appendRun writes entry and loadRuns returns it', () => {
  const logPath = path.join(mkTmp(), 'runs.json');
  const entry = { name: 'fix-auth', targetPath: '/proj', startedAt: '2026-01-01T00:00:00Z' };
  appendRun(logPath, entry);
  const runs = loadRuns(logPath);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], entry);
});

test('appendRun accumulates multiple entries in order', () => {
  const logPath = path.join(mkTmp(), 'runs.json');
  appendRun(logPath, { name: 'first', targetPath: '/a', startedAt: '2026-01-01T00:00:00Z' });
  appendRun(logPath, { name: 'second', targetPath: '/b', startedAt: '2026-01-02T00:00:00Z' });
  const runs = loadRuns(logPath);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].name, 'first');
  assert.equal(runs[1].name, 'second');
});
