'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { reap } = require('../steps/lib/fixtureReaper');

// BL-458: reap()'s own file-parsing/kill branches have no unit coverage —
// the acceptance suite's fixture-process-leak-02 scenario proves the
// SIGNAL-HANDLING mechanism (onAbnormalExit/track) against one complete,
// always-valid fixture, but never exercises reap()'s missing/corrupt-input
// branches. Deliberately never requires track()/onAbnormalExit() here —
// those install real process.on('exit'|'SIGINT'|'SIGTERM') listeners on
// THIS test process itself (a signal handler that calls process.exit(1)
// would kill the test runner on a real Ctrl-C/CI cancellation), so this
// file only ever calls the plain, synchronous reap(root) export, per the
// BL-121 "never target the test's own process" posture one layer up: real
// disposable child processes stand in for "a live pid to kill", never this
// process's own pid.

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-fixture-reaper-test-'));
}

function opDir(root) {
  const d = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function spawnDisposable() {
  const child = spawn('sleep', ['30'], { stdio: 'ignore' });
  return child;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

test('reap() kills both the bridge and bot pid from a valid status.json', async () => {
  const root = mkRoot();
  const dir = opDir(root);
  const bridge = spawnDisposable();
  const bot = spawnDisposable();
  try {
    fs.writeFileSync(
      path.join(dir, 'front-desk-supervisor.status.json'),
      JSON.stringify({ bridge: { pid: bridge.pid }, bot: { pid: bot.pid } })
    );
    reap(root);
    assert.ok(await waitFor(() => !alive(bridge.pid), 2000), 'expected bridge pid to be killed');
    assert.ok(await waitFor(() => !alive(bot.pid), 2000), 'expected bot pid to be killed');
  } finally {
    bridge.kill('SIGKILL');
    bot.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reap() falls back to the standalone pidfile when status.json is missing', async () => {
  const root = mkRoot();
  const dir = opDir(root);
  const supervisor = spawnDisposable();
  try {
    fs.writeFileSync(path.join(dir, 'front-desk-supervisor.pid'), String(supervisor.pid));
    reap(root);
    assert.ok(await waitFor(() => !alive(supervisor.pid), 2000), 'expected supervisor pid to be killed via the pidfile');
  } finally {
    supervisor.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reap() falls through to the pidfile kill when status.json is corrupt/unparseable', async () => {
  const root = mkRoot();
  const dir = opDir(root);
  const supervisor = spawnDisposable();
  try {
    fs.writeFileSync(path.join(dir, 'front-desk-supervisor.status.json'), '{not valid json');
    fs.writeFileSync(path.join(dir, 'front-desk-supervisor.pid'), String(supervisor.pid));
    assert.doesNotThrow(() => reap(root));
    assert.ok(await waitFor(() => !alive(supervisor.pid), 2000), 'expected the pidfile kill to still run despite corrupt status.json');
  } finally {
    supervisor.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reap() kills a live tmux server referenced by the tmux-socket pointer file', async () => {
  const root = mkRoot();
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const socketPath = path.join(root, 'role.sock');
  execFileSync('tmux', ['-S', socketPath, 'new-session', '-d', '-s', 'fixture-reaper-unit-test']);
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), socketPath);
  try {
    reap(root);
    const killed = await waitFor(() => {
      try {
        execFileSync('tmux', ['-S', socketPath, 'list-sessions'], { stdio: 'ignore' });
        return false;
      } catch {
        return true;
      }
    }, 2000);
    assert.ok(killed, 'expected the tmux server to be killed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reap() on a root with no operator dir and no tmux pointer does nothing and does not throw', () => {
  const root = mkRoot();
  try {
    assert.doesNotThrow(() => reap(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reap() is idempotent — calling it twice on the same root after files are gone does not throw', async () => {
  const root = mkRoot();
  const dir = opDir(root);
  const supervisor = spawnDisposable();
  try {
    fs.writeFileSync(path.join(dir, 'front-desk-supervisor.pid'), String(supervisor.pid));
    reap(root);
    await waitFor(() => !alive(supervisor.pid), 2000);
    fs.rmSync(root, { recursive: true, force: true });
    assert.doesNotThrow(() => reap(root));
  } finally {
    supervisor.kill('SIGKILL');
  }
});
