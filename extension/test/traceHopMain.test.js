/**
 * trace-hop CLI entry point (main) — exercised as a real subprocess since
 * main() calls process.exit() on error paths, which would kill the test
 * runner if invoked in-process.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'trace-hop.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-tracehop-cli-'));
}

function run(args, envOverrides) {
  const tracesDir = envOverrides.SWARMFORGE_TRACES_DIR ?? mkTmp();
  const env = {
    ...process.env,
    SWARMFORGE_TRACES_DIR: tracesDir,
    ...envOverrides,
  };
  delete env.SWARMFORGE_ROLE;
  if (envOverrides.SWARMFORGE_ROLE) {
    env.SWARMFORGE_ROLE = envOverrides.SWARMFORGE_ROLE;
  }
  const result = spawnSync('node', [CLI_PATH, ...args], { encoding: 'utf8', env });
  return { ...result, tracesDir };
}

test('main exits 1 when SWARMFORGE_ROLE is not set', () => {
  const result = run(['abc123', 'receive'], {});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SWARMFORGE_ROLE is not set/);
});

test('main exits 1 when traceId or command is missing', () => {
  const result = run(['abc123'], { SWARMFORGE_ROLE: 'coder' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: trace-hop\.js/);
});

test('main rejects a traceId with path traversal', () => {
  const result = run(['../etc/passwd', 'receive'], { SWARMFORGE_ROLE: 'coder' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid traceId/);
});

test('main rejects a traceId with a path separator', () => {
  const result = run(['foo/bar', 'receive'], { SWARMFORGE_ROLE: 'coder' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid traceId/);
});

test('main rejects an unknown command', () => {
  const result = run(['abc123', 'bogus'], { SWARMFORGE_ROLE: 'coder' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command "bogus"/);
});

test('main requires a decision argument for decide', () => {
  const result = run(['abc123', 'decide'], { SWARMFORGE_ROLE: 'coder' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: trace-hop\.js <traceId> decide/);
});

test('main requires a reason argument for retry', () => {
  const result = run(['abc123', 'retry'], { SWARMFORGE_ROLE: 'coder' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: trace-hop\.js <traceId> retry/);
});

test('main writes HOP and STATE_CHANGE lines for receive', () => {
  const result = run(['trace-1', 'receive'], { SWARMFORGE_ROLE: 'coder' });
  assert.equal(result.status, 0);
  const logPath = path.join(result.tracesDir, 'trace-1.log');
  const content = fs.readFileSync(logPath, 'utf8');
  assert.match(content, /^HOP coder .+ action=receive state=received$/m);
  assert.match(content, /^STATE_CHANGE coder .+ received->coding$/m);
});

test('main writes a DECISION line for decide with detail', () => {
  const result = run(['trace-2', 'decide', 'forward_to_cleaner', 'looks good'], {
    SWARMFORGE_ROLE: 'coder',
  });
  assert.equal(result.status, 0);
  const content = fs.readFileSync(path.join(result.tracesDir, 'trace-2.log'), 'utf8');
  assert.match(content, /^DECISION coder .+ decision=forward_to_cleaner details="looks good"$/m);
});

test('main writes an incrementing attempt number across repeated retries', () => {
  const tracesDir = mkTmp();
  const first = run(['trace-3', 'retry', 'flaky test'], {
    SWARMFORGE_ROLE: 'coder',
    SWARMFORGE_TRACES_DIR: tracesDir,
  });
  assert.equal(first.status, 0);
  const second = run(['trace-3', 'retry', 'flaky test again'], {
    SWARMFORGE_ROLE: 'coder',
    SWARMFORGE_TRACES_DIR: tracesDir,
  });
  assert.equal(second.status, 0);

  const content = fs.readFileSync(path.join(tracesDir, 'trace-3.log'), 'utf8');
  assert.match(content, /^RETRY coder .+ attempt=1 reason="flaky test"$/m);
  assert.match(content, /^RETRY coder .+ attempt=2 reason="flaky test again"$/m);
});

test('main reports a fatal error when the trace log cannot be written', () => {
  const tracesDir = mkTmp();
  fs.chmodSync(tracesDir, 0o555);
  try {
    const result = run(['trace-4', 'receive'], {
      SWARMFORGE_ROLE: 'coder',
      SWARMFORGE_TRACES_DIR: tracesDir,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Fatal error: Failed to append to trace log/);
  } finally {
    fs.chmodSync(tracesDir, 0o755);
  }
});
