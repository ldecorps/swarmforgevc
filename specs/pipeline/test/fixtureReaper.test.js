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

// BL-817 invariant 2: the discriminator is the socket PATH alone, never the
// session name - these fixtures deliberately reuse the live swarm's own
// session names. A real tmux server whose socket happens to sit at the
// exact shape swarm_socket_lib.bb's primary-socket-path writes
// (.swarmforge/tmux/<hash>.sock) must survive reap(), even though this one
// is a disposable fixture server with nothing special about it otherwise -
// proving the refusal is driven by the path shape, not by anything else
// about this particular socket.
test('reap() refuses to kill a tmux server whose socket path matches the live repo .swarmforge/tmux/*.sock shape', async () => {
  // Deliberately NOT mkRoot() (os.tmpdir(), which resolves to macOS's long
  // /var/folders/.../T/ path) - a unix socket's sun_path is capped at ~104
  // bytes on macOS (the exact constraint swarm_socket_lib.bb's own header
  // documents), and os.tmpdir() plus '.swarmforge/tmux/<name>.sock' alone
  // can exceed it. /tmp is short enough with plenty of room to spare.
  const root = fs.mkdtempSync('/tmp/sfvc-r2-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'tmux'), { recursive: true });
  const socketPath = path.join(root, '.swarmforge', 'tmux', 'abc123.sock');
  execFileSync('tmux', ['-S', socketPath, 'new-session', '-d', '-s', 'fixture-reaper-guard-test']);
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), socketPath);
  try {
    reap(root);
    // Give reap() every chance it would need to have killed a real one.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.doesNotThrow(
      () => execFileSync('tmux', ['-S', socketPath, 'list-sessions'], { stdio: 'ignore' }),
      'expected the tmux server at a live-shaped socket path to survive reap()'
    );
  } finally {
    try {
      execFileSync('tmux', ['-S', socketPath, 'kill-server'], { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
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

// BL-1636: trackedTmpRoot(prefix) itself has no unit coverage anywhere -
// the property/acceptance suites only feed its NAME as text to the
// finder (proving the finder recognises the call site), never actually
// invoke the function and observe what it does. Its own contract - a
// created directory under /tmp with the owner-pid name shape, registered
// so onAbnormalExit removes it on the process's OWN exit (not just a
// signal) - is exactly the kind of behaviour this file's other tests
// exist to prove for reap(). Per this file's own stated posture above,
// track()/onAbnormalExit() (and so trackedTmpRoot, which calls
// onAbnormalExit internally) are never required into THIS test process -
// a real disposable CHILD process stands in, the same as every kill-path
// test above.
const FIXTURE_REAPER_PATH = path.join(__dirname, '..', 'steps', 'lib', 'fixtureReaper.js');

function spawnTrackedTmpRootChild(prefix, { exitMode }) {
  const script =
    `const { trackedTmpRoot } = require(${JSON.stringify(FIXTURE_REAPER_PATH)});` +
    `const root = trackedTmpRoot(${JSON.stringify(prefix)});` +
    `process.stdout.write(root + '\\n');` +
    (exitMode === 'normal'
      ? `process.exit(0);`
      : `setInterval(() => {}, 1000);`); // idle, waiting to be signalled.
  return spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
}

function readChildStdoutLine(child) {
  return new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        resolve(buf.slice(0, nl));
      }
    });
    child.on('error', reject);
  });
}

test('trackedTmpRoot() creates a bl-prefixed, owner-pid-named root under /tmp, and removes it on the child process\'s own normal exit', async () => {
  // The child prints its root and calls process.exit(0) in the same tick,
  // so by the time this process's readChildStdoutLine resolves the child
  // may already be exiting - asserting the root still exists at that
  // instant would be racing the very behaviour under test. The name-shape
  // assertion runs first (the root's existence is not load-bearing for
  // it: fs.mkdtempSync already returned a real path when the child printed
  // it), then this waits for the child to actually exit before asserting
  // removal - the property this test exists to prove.
  const child = spawnTrackedTmpRootChild('bl1636-normal-', { exitMode: 'normal' });
  const root = await readChildStdoutLine(child);
  try {
    assert.ok(root.startsWith(path.join(os.tmpdir(), 'bl1636-normal-')), `unexpected root: ${root}`);
    assert.match(path.basename(root), new RegExp(`^bl1636-normal-${child.pid}-`), `expected the child's own pid in the root name, got: ${root}`);
    await waitFor(() => !alive(child.pid), 2000);
    assert.equal(fs.existsSync(root), false, 'expected the root to be gone after the child exited normally');
  } finally {
    if (alive(child.pid)) {
      child.kill('SIGKILL');
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('trackedTmpRoot() removes its root when the child process is SIGTERM\'d', async () => {
  const child = spawnTrackedTmpRootChild('bl1636-sigterm-', { exitMode: 'signal' });
  const root = await readChildStdoutLine(child);
  try {
    assert.equal(fs.existsSync(root), true, 'expected the root to exist before signalling');
    child.kill('SIGTERM');
    await waitFor(() => !alive(child.pid), 2000);
    assert.equal(fs.existsSync(root), false, 'expected the root to be gone after the child was SIGTERM\'d');
  } finally {
    if (alive(child.pid)) {
      child.kill('SIGKILL');
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
