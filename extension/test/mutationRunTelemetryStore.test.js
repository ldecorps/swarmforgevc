'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  appendMutationRunRecord,
  readMutationRunRecords,
} = require('../out/mutation/mutationRunTelemetryStore');

const RECORD = {
  started_at: '2026-07-09T12:00:00.000Z',
  ended_at: '2026-07-09T12:02:05.000Z',
  elapsed_s: 125,
  role: 'hardender',
  scope: 'out/foo.js',
  total: 10,
  incremental: true,
  concurrency: 8,
  killed: 8,
  survived: 1,
  no_coverage: 0,
  timed_out: 1,
  ignored: 0,
  build_sha: 'abc',
};

test('appendMutationRunRecord appends without rewriting prior lines', () => {
  const dir = mkTmpDir('bl593-telemetry-');
  try {
    const file = path.join(dir, 'mutation-runs.jsonl');
    appendMutationRunRecord(file, RECORD);
    appendMutationRunRecord(file, { ...RECORD, elapsed_s: 90, build_sha: 'def' });
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).elapsed_s, 125);
    assert.equal(JSON.parse(lines[1]).elapsed_s, 90);
    assert.deepEqual(readMutationRunRecords(file).length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
