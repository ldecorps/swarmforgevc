const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeHeartbeat, readHeartbeat } = require('../out/tools/heartbeat');
const { withHeartbeat, resetBeatCount } = require('../out/tools/toolDecorator');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-hb-'));
}

// ── writeHeartbeat / readHeartbeat ────────────────────────────────────────

test('writeHeartbeat creates a YAML file readable by readHeartbeat', () => {
  const dir = mkTmp();
  writeHeartbeat(dir, {
    role: 'coder', pid: 1234, last_beat: '2026-06-29T21:00:00Z',
    last_tool: 'write_file', phase: 'entry', in_flight: true, beat_count: 1,
  });
  const hb = readHeartbeat(dir, 'coder');
  assert.ok(hb);
  assert.equal(hb.role, 'coder');
  assert.equal(hb.pid, 1234);
  assert.equal(hb.last_beat, '2026-06-29T21:00:00Z');
  assert.equal(hb.last_tool, 'write_file');
  assert.equal(hb.phase, 'entry');
  assert.equal(hb.in_flight, true);
  assert.equal(hb.beat_count, 1);
});

test('writeHeartbeat overwrites the previous file atomically (no .tmp left)', () => {
  const dir = mkTmp();
  writeHeartbeat(dir, { role: 'coder', pid: 1, last_beat: '2026-06-29T21:00:00Z', last_tool: 't', phase: 'entry', in_flight: true, beat_count: 1 });
  writeHeartbeat(dir, { role: 'coder', pid: 1, last_beat: '2026-06-29T21:00:01Z', last_tool: 't', phase: 'exit', in_flight: false, beat_count: 2 });
  const files = fs.readdirSync(dir);
  assert.deepEqual(files.filter(f => f.endsWith('.tmp')), []);
  const hb = readHeartbeat(dir, 'coder');
  assert.equal(hb.phase, 'exit');
  assert.equal(hb.in_flight, false);
  assert.equal(hb.beat_count, 2);
});

test('readHeartbeat returns undefined for missing role', () => {
  const dir = mkTmp();
  assert.equal(readHeartbeat(dir, 'missing'), undefined);
});

// ── withHeartbeat ─────────────────────────────────────────────────────────

test('withHeartbeat writes entry beat before fn runs', () => {
  const dir = mkTmp();
  resetBeatCount();
  let capturedEntry = null;
  withHeartbeat(dir, 'coder', 42, 'write_file', () => {
    capturedEntry = readHeartbeat(dir, 'coder');
  });
  assert.ok(capturedEntry);
  assert.equal(capturedEntry.phase, 'entry');
  assert.equal(capturedEntry.in_flight, true);
  assert.equal(capturedEntry.last_tool, 'write_file');
});

test('withHeartbeat writes exit beat after fn returns', () => {
  const dir = mkTmp();
  resetBeatCount();
  withHeartbeat(dir, 'coder', 42, 'write_file', () => 'ok');
  const hb = readHeartbeat(dir, 'coder');
  assert.equal(hb.phase, 'exit');
  assert.equal(hb.in_flight, false);
});

test('withHeartbeat clears in_flight even when fn throws', () => {
  const dir = mkTmp();
  resetBeatCount();
  assert.throws(() => {
    withHeartbeat(dir, 'coder', 42, 'write_file', () => { throw new Error('boom'); });
  });
  const hb = readHeartbeat(dir, 'coder');
  assert.equal(hb.in_flight, false);
  assert.equal(hb.phase, 'exit');
});

test('beat_count increments on each call within one process', () => {
  const dir = mkTmp();
  resetBeatCount();
  const counts = [];
  for (let i = 0; i < 3; i++) {
    withHeartbeat(dir, 'coder', 42, 'tool', () => {
      counts.push(readHeartbeat(dir, 'coder').beat_count);
    });
  }
  assert.deepEqual(counts, [1, 2, 3]);
});

test('withHeartbeat returns the value from fn', () => {
  const dir = mkTmp();
  resetBeatCount();
  const result = withHeartbeat(dir, 'coder', 42, 'tool', () => 99);
  assert.equal(result, 99);
});

test('pid is written correctly to heartbeat file', () => {
  const dir = mkTmp();
  resetBeatCount();
  withHeartbeat(dir, 'cleaner', 9999, 'lint', () => {});
  const hb = readHeartbeat(dir, 'cleaner');
  assert.equal(hb.pid, 9999);
  assert.equal(hb.role, 'cleaner');
});
