const assert = require('node:assert/strict');
const cp = require('node:child_process');
const { installInProcessTmux, installFakeTmux } = require('./helpers/fakeTmux');

// BL-377: direct unit coverage of the new in-process tmux double itself -
// test/helpers/fakeTmux.js's own new behavior, exercised here in isolation
// from any real consumer, mirroring how the PATH-executable fake's own
// fidelity (rule matching, call log, mid-test replacement) is implicitly
// proven by every one of its existing consumers today.

test('installInProcessTmux serves a matching rule without spawning a real process', () => {
  const originalSpawnSync = cp.spawnSync;
  const fake = installInProcessTmux([{ subcommand: 'list-sessions', exitCode: 0, stdout: 'one\ntwo\n' }]);
  try {
    const result = cp.spawnSync('tmux', ['list-sessions'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'one\ntwo\n');
    assert.notEqual(cp.spawnSync, originalSpawnSync, 'expected spawnSync to have been replaced while installed');
  } finally {
    fake.restore();
  }
});

test('installInProcessTmux falls back to exitCode 0 / empty output when no rule matches', () => {
  const fake = installInProcessTmux([{ subcommand: 'capture-pane', exitCode: 0, stdout: 'hi' }]);
  try {
    const result = cp.spawnSync('tmux', ['send-keys'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    fake.restore();
  }
});

test('installInProcessTmux records the exact argv passed to each tmux call', () => {
  const fake = installInProcessTmux([{ subcommand: 'capture-pane', exitCode: 0, stdout: '' }]);
  try {
    cp.spawnSync('tmux', ['-S', '/tmp/sock', 'capture-pane', '-t', 'sess:0.1', '-p']);
    assert.deepEqual(fake.calls(), [['-S', '/tmp/sock', 'capture-pane', '-t', 'sess:0.1', '-p']]);
  } finally {
    fake.restore();
  }
});

test('installInProcessTmux never intercepts a non-tmux command - it passes through to the real spawnSync', () => {
  const fake = installInProcessTmux([{ subcommand: 'anything', exitCode: 1, stdout: 'should never be seen' }]);
  try {
    const result = cp.spawnSync('echo', ['hello'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), 'hello');
    assert.deepEqual(fake.calls(), [], 'expected the non-tmux call to never be logged as a tmux call');
  } finally {
    fake.restore();
  }
});

// BL-377 in-process-tmux-double-03: rules can be replaced mid-test.
test('installInProcessTmux setRules replaces the rules a subsequent call is matched against', () => {
  const fake = installInProcessTmux([{ subcommand: 'has-session', exitCode: 0 }]);
  try {
    const alive = cp.spawnSync('tmux', ['has-session', '-t', 'sess']);
    assert.equal(alive.status, 0);

    fake.setRules([{ subcommand: 'has-session', exitCode: 1 }]);

    const dead = cp.spawnSync('tmux', ['has-session', '-t', 'sess']);
    assert.equal(dead.status, 1);
  } finally {
    fake.restore();
  }
});

// BL-377 in-process-tmux-double-05: restores exactly what it replaced.
test('installInProcessTmux.restore() puts back the exact spawnSync it replaced', () => {
  const originalSpawnSync = cp.spawnSync;
  const fake = installInProcessTmux([]);
  assert.notEqual(cp.spawnSync, originalSpawnSync);
  fake.restore();
  assert.equal(cp.spawnSync, originalSpawnSync, 'expected spawnSync to be restored to the exact original function');
});

// BL-377 in-process-tmux-double-04: the PATH-executable fake still works
// unchanged, coexisting with the in-process double's own existence in this
// same helper file.
test('installFakeTmux (the PATH-executable double) still works, for the genuine subprocess boundary case', () => {
  const fake = installFakeTmux([{ subcommand: 'list-sessions', exitCode: 0, stdout: 'real-subprocess-path\n' }]);
  try {
    const { execFileSync } = require('node:child_process');
    const output = execFileSync('tmux', ['list-sessions'], { encoding: 'utf8' });
    assert.equal(output, 'real-subprocess-path\n');
  } finally {
    fake.restore();
  }
});
