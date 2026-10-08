const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { spawn } = require('node:child_process');
const {
  buildKillSessionArgs,
  stopSwarm,
  stopSwarmOnExtensionShutdown,
  socketOwnedByTarget,
  drainAgentSessions,
  clearStaleSwarmState,
} = require('../out/swarm/swarmStopper');
const { installInProcessTmux } = require('./helpers/fakeTmux');

function mkTmp() {
  return mkTmpDir('sfvc-stop-');
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ownedSocket(tmp) {
  return path.join(tmp, '.swarmforge', 'tmux', 'swarm.sock');
}

test('buildKillSessionArgs returns tmux kill-session args for each session', () => {
  const args = buildKillSessionArgs('/tmp/swarm.sock', ['swarmforge-coder', 'swarmforge-cleaner']);
  assert.deepEqual(args, [
    ['-S', '/tmp/swarm.sock', 'kill-session', '-t', 'swarmforge-coder'],
    ['-S', '/tmp/swarm.sock', 'kill-session', '-t', 'swarmforge-cleaner'],
  ]);
});

test('buildKillSessionArgs returns empty array when no sessions given', () => {
  const args = buildKillSessionArgs('/tmp/swarm.sock', []);
  assert.deepEqual(args, []);
});

test('stopSwarm is an idempotent success when no tmux socket file exists', () => {
  const tmp = mkTmp();
  const result = stopSwarm(tmp);
  assert.equal(result.success, true);
  assert.match(result.message, /already stopped/);
  assert.deepEqual(result.sessionsKilled, []);
});

test('stopSwarm succeeds and clears state when sessions.tsv is empty', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), ownedSocket(tmp));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'sessions.tsv'), '');
  const result = stopSwarm(tmp);
  assert.equal(result.success, true);
  assert.match(result.message, /already stopped/);
  assert.deepEqual(result.sessionsKilled, []);
  // stale state must be cleared so the next launch starts clean
  assert.equal(fs.existsSync(path.join(tmp, '.swarmforge', 'tmux-socket')), false);
  assert.equal(fs.existsSync(path.join(tmp, '.swarmforge', 'sessions.tsv')), false);
});

test('stopSwarm succeeds and clears stale state when the socket is dead (crashed swarm)', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), ownedSocket(tmp));
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );
  const result = stopSwarm(tmp);
  assert.equal(result.success, true);
  assert.match(result.message, /stale swarm state cleared/);
  assert.deepEqual(result.sessionsKilled, []);
  assert.equal(fs.existsSync(path.join(tmp, '.swarmforge', 'tmux-socket')), false);
  assert.equal(fs.existsSync(path.join(tmp, '.swarmforge', 'sessions.tsv')), false);
});

test('stopSwarm tolerates a missing daemon pid file', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), ownedSocket(tmp));
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );
  // no daemon/handoffd.pid — code must not throw
  const result = stopSwarm(tmp);
  assert.equal(result.success, true);
});

test('stopSwarm reports success and the killed session list when tmux kills succeed', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), ownedSocket(tmp));
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n2\tcleaner\tswarmforge-cleaner\tCleaner\tclaude\n'
  );
  const fake = installInProcessTmux([{ subcommand: 'kill-session', exitCode: 0 }]);
  try {
    const result = stopSwarm(tmp);
    assert.equal(result.success, true);
    assert.deepEqual(result.sessionsKilled, ['swarmforge-coder', 'swarmforge-cleaner']);
    // BL-2067: exact message (not just a substring match) - proves the
    // killed-session list is joined with ', ', not concatenated bare.
    assert.equal(result.message, 'Stopped 2 session(s): swarmforge-coder, swarmforge-cleaner');
    // BL-2067: the server-wide kill-server call itself was never checked -
    // every prior assertion here only covered the per-session kills.
    assert.deepEqual(
      fake.calls().filter((c) => c.includes('kill-server')),
      [['-S', ownedSocket(tmp), 'kill-server']]
    );
  } finally {
    fake.restore();
  }
});

test('stopSwarm refuses a worktree pointer at another root socket', () => {
  const main = mkTmp();
  const worktree = mkTmp();
  const foreign = path.join(main, '.swarmforge', 'tmux', 'live.sock');
  mkdirp(path.dirname(foreign));
  fs.writeFileSync(foreign, '');
  mkdirp(path.join(worktree, '.swarmforge'));
  fs.writeFileSync(path.join(worktree, '.swarmforge', 'tmux-socket'), foreign);
  fs.writeFileSync(
    path.join(worktree, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );

  const fake = installInProcessTmux([{ subcommand: 'kill-server', exitCode: 0 }]);
  try {
    const result = stopSwarm(worktree);
    assert.equal(result.success, true);
    assert.deepEqual(result.sessionsKilled, []);
    assert.match(result.message, /outside this root/);
    assert.deepEqual(fake.calls(), []);
    assert.equal(fs.existsSync(foreign), true);
    assert.equal(fs.existsSync(path.join(worktree, '.swarmforge', 'tmux-socket')), false);
  } finally {
    fake.restore();
  }
});

// BL-2052: drainAgentSessions had no test of any kind before this pass -
// a success-path case alongside the refusal case below so neither branch
// of its own socketOwnedByTarget gate is left uncovered.
test('drainAgentSessions kills each role session and reports the count when the socket is owned', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), ownedSocket(tmp));
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n2\tcleaner\tswarmforge-cleaner\tCleaner\tclaude\n'
  );
  const fake = installInProcessTmux([{ subcommand: 'kill-session', exitCode: 0 }]);
  try {
    const result = drainAgentSessions(tmp);
    assert.equal(result.success, true);
    assert.equal(result.sessionsStopped, 2);
    assert.deepEqual(result.sessionsAttempted, ['swarmforge-coder', 'swarmforge-cleaner']);
    assert.match(result.message, /stopped 2\/2 role session\(s\)/);
    // drain-agents leaves the tmux server itself (and the socket file)
    // up - distinct from a full stop.
    assert.equal(fs.existsSync(path.join(tmp, '.swarmforge', 'tmux-socket')), true);
  } finally {
    fake.restore();
  }
});

// BL-2052 QA bounce D1: socketOwnedByTarget gates drainAgentSessions,
// clearStaleSwarmState, stopSwarm and stopSwarmCompletely, but only
// stopSwarm had a test proving a foreign socket is refused.
test('drainAgentSessions refuses a worktree pointer at another root socket', () => {
  const main = mkTmp();
  const worktree = mkTmp();
  const foreign = path.join(main, '.swarmforge', 'tmux', 'live.sock');
  mkdirp(path.dirname(foreign));
  fs.writeFileSync(foreign, '');
  mkdirp(path.join(worktree, '.swarmforge'));
  fs.writeFileSync(path.join(worktree, '.swarmforge', 'tmux-socket'), foreign);
  fs.writeFileSync(
    path.join(worktree, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );

  const fake = installInProcessTmux([{ subcommand: 'kill-session', exitCode: 0 }]);
  try {
    const result = drainAgentSessions(worktree);
    assert.equal(result.success, true);
    assert.equal(result.sessionsStopped, 0);
    assert.deepEqual(result.sessionsAttempted, []);
    assert.match(result.message, /outside this root/);
    assert.deepEqual(fake.calls(), []);
    assert.equal(fs.existsSync(foreign), true);
  } finally {
    fake.restore();
  }
});

test('clearStaleSwarmState refuses a worktree pointer at another root socket, but still clears its own stale state', () => {
  const main = mkTmp();
  const worktree = mkTmp();
  const foreign = path.join(main, '.swarmforge', 'tmux', 'live.sock');
  mkdirp(path.dirname(foreign));
  fs.writeFileSync(foreign, '');
  mkdirp(path.join(worktree, '.swarmforge'));
  fs.writeFileSync(path.join(worktree, '.swarmforge', 'tmux-socket'), foreign);

  const fake = installInProcessTmux([{ subcommand: 'kill-server', exitCode: 0 }]);
  try {
    clearStaleSwarmState(worktree);
    assert.deepEqual(fake.calls(), []);
    assert.equal(fs.existsSync(foreign), true);
    assert.equal(fs.existsSync(path.join(worktree, '.swarmforge', 'tmux-socket')), false);
  } finally {
    fake.restore();
  }
});

// BL-2067 (deferred Stryker pass over the BL-2052 hotfix's lines): every
// clearStaleSwarmState test before this one used a FOREIGN socket, so the
// OWNED branch of its own socketOwnedByTarget gate - the one that actually
// runs `tmux kill-server` - had never executed at all (0% coverage on the
// gate's true side and the kill-server call it guards).
test('clearStaleSwarmState kills the tmux server when the socket is genuinely owned', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  const owned = ownedSocket(tmp);
  mkdirp(path.dirname(owned));
  fs.writeFileSync(owned, '');
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), owned);

  const fake = installInProcessTmux([{ subcommand: 'kill-server', exitCode: 0 }]);
  try {
    clearStaleSwarmState(tmp);
    assert.deepEqual(fake.calls(), [['-S', owned, 'kill-server']]);
    assert.equal(fs.existsSync(path.join(tmp, '.swarmforge', 'tmux-socket')), false);
  } finally {
    fake.restore();
  }
});

// BL-2067: drainAgentSessions's own noneMsg branch (socketRefusalOrAbsent's
// SECOND argument, "no tmux socket") is distinct from its refusedMsg branch
// (a real but foreign socket) - every prior test exercised only the latter.
test('drainAgentSessions reports "no tmux socket" when none was ever recorded', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));

  const result = drainAgentSessions(tmp);
  assert.equal(result.success, true);
  assert.equal(result.sessionsStopped, 0);
  assert.match(result.message, /no tmux socket — nothing to drain/);
});

// BL-2067: the kill-session loop's `if (result.exitCode === 0)` had no
// test where one session's kill actually failed - every prior fixture's
// single installInProcessTmux rule returned exitCode 0 for every call, so
// a mutant hard-coding this condition to `true` passed every existing test.
test('drainAgentSessions counts only the sessions whose kill-session actually succeeded', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), ownedSocket(tmp));
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n2\tcleaner\tswarmforge-cleaner\tCleaner\tclaude\n'
  );
  const fake = installInProcessTmux([
    { subcommand: 'kill-session', argsInclude: 'swarmforge-coder', exitCode: 0 },
    { subcommand: 'kill-session', argsInclude: 'swarmforge-cleaner', exitCode: 1 },
  ]);
  try {
    const result = drainAgentSessions(tmp);
    assert.equal(result.success, true);
    assert.equal(result.sessionsStopped, 1);
    assert.deepEqual(result.sessionsAttempted, ['swarmforge-coder', 'swarmforge-cleaner']);
    assert.match(result.message, /stopped 1\/2 role session\(s\)/);
  } finally {
    fake.restore();
  }
});

test('stopSwarm refuses an in-root pointer whose directory is a symlink to another root', () => {
  const main = mkTmp();
  const worktree = mkTmp();
  const mainTmux = path.join(main, '.swarmforge', 'tmux');
  mkdirp(mainTmux);
  fs.writeFileSync(path.join(mainTmux, 'live.sock'), '');
  mkdirp(path.join(worktree, '.swarmforge'));
  fs.symlinkSync(mainTmux, path.join(worktree, '.swarmforge', 'tmux'));
  fs.writeFileSync(
    path.join(worktree, '.swarmforge', 'tmux-socket'),
    path.join(worktree, '.swarmforge', 'tmux', 'live.sock')
  );
  fs.writeFileSync(
    path.join(worktree, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );

  const fake = installInProcessTmux([{ subcommand: 'kill-server', exitCode: 0 }]);
  try {
    const result = stopSwarm(worktree);
    assert.match(result.message, /outside this root/);
    assert.deepEqual(fake.calls(), []);
    assert.equal(fs.existsSync(path.join(mainTmux, 'live.sock')), true);
  } finally {
    fake.restore();
  }
});

// BL-2052 hardening: physicalPath's own `if (parent === head) { return
// path.resolve(p); }` terminal fallback (the "no ancestor resolves at
// all" case) has no coverage from any real filesystem fixture - every
// real path has an existing root ("/"), so fs.realpathSync always
// succeeds before that walk-up can ever bottom out. Only a stubbed
// fs.realpathSync that NEVER succeeds can reach it, and reaching it
// safely (a sane boolean, no throw, no infinite loop) is exactly the
// guarantee this defensive branch exists to make.
test('socketOwnedByTarget never throws or loops when no path segment resolves at all', () => {
  const originalRealpathSync = fs.realpathSync;
  fs.realpathSync = () => {
    throw new Error('ENOENT: simulated - nothing resolves on this host');
  };
  try {
    const result = socketOwnedByTarget('/a/b/c', '/a/b/c/.swarmforge/tmux/sock');
    assert.equal(typeof result, 'boolean');
    // Both sides fall back to path.resolve(p) unmodified, so the socket's
    // directory (/a/b/c/.swarmforge/tmux) genuinely IS under the target's
    // own .swarmforge/ - this is the one case where the unresolvable
    // fallback still computes the right, safe answer.
    assert.equal(result, true);
  } finally {
    fs.realpathSync = originalRealpathSync;
  }
});

test('socketOwnedByTarget still refuses a foreign socket when no path segment resolves at all', () => {
  const originalRealpathSync = fs.realpathSync;
  fs.realpathSync = () => {
    throw new Error('ENOENT: simulated - nothing resolves on this host');
  };
  try {
    const result = socketOwnedByTarget('/a/b/target', '/x/y/foreign/.swarmforge/tmux/sock');
    assert.equal(result, false);
  } finally {
    fs.realpathSync = originalRealpathSync;
  }
});

// BL-2052 hardening: a socket under a SIBLING directory that merely
// shares ".swarmforge" as a text prefix (".swarmforge-evil", never the
// real ".swarmforge/") must never be treated as owned - the ownership
// check requires a path SEPARATOR boundary, not a bare string prefix.
// Hand-mutation proof: dropping the "+ path.sep" the real code appends
// to its owned-prefix comparison (out/swarm/swarmStopper.js:141) makes
// every pre-existing test in this file and swarmStopper.test.js pass
// unchanged - only this fixture shape observes the difference.
test('socketOwnedByTarget refuses a sibling directory that only shares ".swarmforge" as a text prefix', () => {
  const root = mkTmp();
  const evilSock = path.join(root, '.swarmforge-evil', 'tmux', 'sock');
  mkdirp(path.dirname(evilSock));
  fs.writeFileSync(evilSock, '');
  assert.equal(socketOwnedByTarget(root, evilSock), false);
});

test('stopSwarm sends SIGTERM to a live daemon pid and still succeeds', async () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), ownedSocket(tmp));
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );
  mkdirp(path.join(tmp, '.swarmforge', 'daemon'));

  // Spawn a real, harmless long-lived process so we have a PID we know is
  // safe to signal (never guess/reuse an arbitrary system PID).
  const dummy = spawn('sleep', ['30']);
  const exited = new Promise((resolve) => dummy.once('exit', (code, signal) => resolve(signal)));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'daemon', 'handoffd.pid'), String(dummy.pid));

  const fake = installInProcessTmux([{ subcommand: 'kill-session', exitCode: 0 }]);
  try {
    const result = stopSwarm(tmp);
    assert.equal(result.success, true);
    const signal = await exited;
    assert.equal(signal, 'SIGTERM');
  } finally {
    fake.restore();
  }
});

test('stopSwarm ignores a daemon pid file with non-numeric content', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), ownedSocket(tmp));
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );
  mkdirp(path.join(tmp, '.swarmforge', 'daemon'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'daemon', 'handoffd.pid'), 'not-a-pid');

  const fake = installInProcessTmux([{ subcommand: 'kill-session', exitCode: 0 }]);
  try {
    assert.doesNotThrow(() => stopSwarm(tmp));
  } finally {
    fake.restore();
  }
});

test('stopSwarm tolerates a daemon pid file pointing at an already-dead process', async () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), ownedSocket(tmp));
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );
  mkdirp(path.join(tmp, '.swarmforge', 'daemon'));

  const dummy = spawn('true', []);
  const deadPid = await new Promise((resolve) => dummy.once('exit', () => resolve(dummy.pid)));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'daemon', 'handoffd.pid'), String(deadPid));

  const fake = installInProcessTmux([{ subcommand: 'kill-session', exitCode: 0 }]);
  try {
    assert.doesNotThrow(() => stopSwarm(tmp));
  } finally {
    fake.restore();
  }
});

test('stopSwarmOnExtensionShutdown is a no-op when target path is missing', () => {
  assert.equal(stopSwarmOnExtensionShutdown(null), null);
  assert.equal(stopSwarmOnExtensionShutdown(undefined), null);
  assert.equal(stopSwarmOnExtensionShutdown(''), null);
});

test('stopSwarmOnExtensionShutdown is a no-op for headless swarms', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), ownedSocket(tmp));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'headless-swarm'), '');

  const fake = installInProcessTmux([
    { subcommand: 'kill-session', exitCode: 0 },
    { subcommand: 'kill-server', exitCode: 0 },
  ]);
  try {
    assert.equal(stopSwarmOnExtensionShutdown(tmp), null);
    assert.equal(fs.existsSync(path.join(tmp, '.swarmforge', 'tmux-socket')), true);
  } finally {
    fake.restore();
  }
});

test('stopSwarmOnExtensionShutdown tears down a live swarm like stopSwarm', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), ownedSocket(tmp));
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );

  const fake = installInProcessTmux([
    { subcommand: 'kill-session', exitCode: 0 },
    { subcommand: 'kill-server', exitCode: 0 },
  ]);
  try {
    const result = stopSwarmOnExtensionShutdown(tmp);
    assert.equal(result?.success, true);
    assert.deepEqual(result?.sessionsKilled, ['swarmforge-coder']);
    assert.equal(fs.existsSync(path.join(tmp, '.swarmforge', 'tmux-socket')), false);
  } finally {
    fake.restore();
  }
});

const { respawnAgent } = require('../out/swarm/tmuxClient');

test('respawnAgent returns failure when launch script missing', () => {
  const result = respawnAgent('/nonexistent-target', 'coder');
  assert.equal(result.success, false);
  assert.ok(result.message.includes('launch script') || result.message.length > 0);
});
