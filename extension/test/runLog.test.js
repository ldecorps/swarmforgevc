const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadRuns, appendRun, updateLastRunForTarget } = require('../out/runs/runLog');

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

test('appendRun creates parent directories when missing', () => {
  const logPath = path.join(mkTmp(), 'nested', 'storage', 'runs.json');
  const entry = { name: 'dogfood-mvp', targetPath: '/proj', startedAt: '2026-01-01T00:00:00Z' };
  appendRun(logPath, entry);
  assert.ok(fs.existsSync(logPath));
  assert.deepEqual(loadRuns(logPath)[0], entry);
});

test('appendRun appends JSONL format (one JSON per line)', () => {
  const logPath = path.join(mkTmp(), 'runs.jsonl');
  appendRun(logPath, { name: 'first', targetPath: '/a', startedAt: '2026-01-01T00:00:00Z' });
  appendRun(logPath, { name: 'second', targetPath: '/b', startedAt: '2026-01-02T00:00:00Z' });
  const runs = loadRuns(logPath);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].name, 'first');
  assert.equal(runs[1].name, 'second');

  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { name: 'first', targetPath: '/a', startedAt: '2026-01-01T00:00:00Z' });
  assert.deepEqual(JSON.parse(lines[1]), { name: 'second', targetPath: '/b', startedAt: '2026-01-02T00:00:00Z' });
});

test('updateLastRunForTarget patches most recent run for target', () => {
  const logPath = path.join(mkTmp(), 'runs.json');
  appendRun(logPath, { name: 'run-one', targetPath: '/proj', startedAt: '2026-01-01T00:00:00Z' });
  appendRun(logPath, { name: 'run-two', targetPath: '/proj', startedAt: '2026-01-02T00:00:00Z' });
  updateLastRunForTarget(logPath, '/proj', { prUrl: 'https://github.com/o/r/pull/1', completedAt: '2026-01-02T01:00:00Z' });
  const runs = loadRuns(logPath);
  assert.equal(runs[0].prUrl, undefined);
  assert.equal(runs[1].prUrl, 'https://github.com/o/r/pull/1');
  assert.equal(runs[1].completedAt, '2026-01-02T01:00:00Z');
});

test('updateLastRunForTarget does nothing when no run matches target', () => {
  const logPath = path.join(mkTmp(), 'runs.json');
  appendRun(logPath, { name: 'run-one', targetPath: '/proj', startedAt: '2026-01-01T00:00:00Z' });
  updateLastRunForTarget(logPath, '/other', { prUrl: 'https://github.com/o/r/pull/1' });
  const runs = loadRuns(logPath);
  assert.equal(runs[0].prUrl, undefined);
});

test('updateLastRunForTarget does nothing when log is empty', () => {
  const logPath = path.join(mkTmp(), 'runs.json');
  updateLastRunForTarget(logPath, '/proj', { prUrl: 'https://github.com/o/r/pull/1' });
  assert.deepEqual(loadRuns(logPath), []);
});
