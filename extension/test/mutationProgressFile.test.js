const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { defaultProgressFilePath, writeProgressRecord, readProgressRecord } = require('../out/mutation/mutationProgressFile');

test('defaultProgressFilePath places the file under .swarmforge/mutation-progress/<role>.json', () => {
  const filePath = defaultProgressFilePath('/repo', 'hardender');
  assert.equal(filePath, path.join('/repo', '.swarmforge', 'mutation-progress', 'hardender.json'));
});

test('writeProgressRecord creates the mutation-progress directory if missing, then readProgressRecord reads it back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mut-progress-'));
  try {
    const filePath = defaultProgressFilePath(dir, 'coder');
    const record = { tested: 1, total: 4, percent: 25, survived: 0, timedOut: 0, elapsed_s: 5, eta_s: 15, updated_at: '2026-07-09T12:00:00.000Z', status: 'running' };
    writeProgressRecord(filePath, record);
    assert.deepEqual(readProgressRecord(filePath), record);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeProgressRecord overwrites a previous record at the same path (refreshed as the run advances)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mut-progress-'));
  try {
    const filePath = defaultProgressFilePath(dir, 'coder');
    writeProgressRecord(filePath, { tested: 1, total: 4, percent: 25, survived: 0, timedOut: 0, elapsed_s: 5, eta_s: 15, updated_at: 't1', status: 'running' });
    writeProgressRecord(filePath, { tested: 2, total: 4, percent: 50, survived: 0, timedOut: 0, elapsed_s: 10, eta_s: 10, updated_at: 't2', status: 'running' });
    assert.equal(readProgressRecord(filePath).tested, 2);
    assert.equal(readProgressRecord(filePath).updated_at, 't2');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readProgressRecord returns null when the file does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mut-progress-'));
  try {
    assert.equal(readProgressRecord(defaultProgressFilePath(dir, 'nope')), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readProgressRecord returns null (not a throw) for a malformed/non-JSON file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mut-progress-'));
  try {
    const filePath = defaultProgressFilePath(dir, 'coder');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'not json{{{', 'utf8');
    assert.equal(readProgressRecord(filePath), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeProgressRecord leaves no stray .tmp file behind after a successful write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mut-progress-'));
  try {
    const filePath = defaultProgressFilePath(dir, 'coder');
    writeProgressRecord(filePath, { tested: 0, total: 1, percent: 0, survived: 0, timedOut: 0, elapsed_s: 0, eta_s: null, updated_at: 't', status: 'running' });
    const entries = fs.readdirSync(path.dirname(filePath));
    assert.deepEqual(entries, ['coder.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
