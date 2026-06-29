const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { appendInputEntry, INPUT_LOG_FILENAME } = require('../out/swarm/inputLog');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-inputlog-'));
}

test('INPUT_LOG_FILENAME is .swarmforge/input-log.jsonl', () => {
  assert.equal(INPUT_LOG_FILENAME, '.swarmforge/input-log.jsonl');
});

test('appendInputEntry creates file on first write', () => {
  const tmp = mkTmp();
  appendInputEntry(tmp, 'coder', 'hello');
  const logPath = path.join(tmp, INPUT_LOG_FILENAME);
  assert.ok(fs.existsSync(logPath));
});

test('appendInputEntry writes valid JSON line', () => {
  const tmp = mkTmp();
  appendInputEntry(tmp, 'coder', 'x');
  const logPath = path.join(tmp, INPUT_LOG_FILENAME);
  const line = fs.readFileSync(logPath, 'utf8').trim();
  const entry = JSON.parse(line);
  assert.equal(entry.role, 'coder');
  assert.equal(entry.data, 'x');
  assert.ok(typeof entry.timestamp === 'string');
});

test('appendInputEntry appends a new line per call', () => {
  const tmp = mkTmp();
  appendInputEntry(tmp, 'coder', 'a');
  appendInputEntry(tmp, 'cleaner', 'b');
  const logPath = path.join(tmp, INPUT_LOG_FILENAME);
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).data, 'a');
  assert.equal(JSON.parse(lines[1]).data, 'b');
});

test('appendInputEntry does not throw when target path is invalid', () => {
  assert.doesNotThrow(() => {
    appendInputEntry('/nonexistent/path', 'coder', 'x');
  });
});
