const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  bounceSwarm,
  buildBounceExtensionCommand,
} = require('../out/swarm/bouncer');

test('bounceSwarm proceeds to launch when stop phase fails (dead swarm)', async () => {
  let launched = false;
  const result = await bounceSwarm('/nonexistent/target', 'test-run', () => {
    return { success: false, message: 'No tmux socket', sessionsKilled: [] };
  }, async () => {
    launched = true;
    return { success: true, message: 'Launched', targetPath: '/nonexistent/target' };
  });

  assert.equal(launched, true);
  assert.equal(result.success, true);
  assert.ok(result.message.includes('proceeding to launch'));
  assert.ok(result.message.includes('Launched'));
});

test('bounceSwarm returns error if launchSwarm fails', async () => {
  const result = await bounceSwarm('/some/target', 'test-run', () => {
    return { success: true, message: 'Stopped', sessionsKilled: ['agent'] };
  }, async () => {
    return { success: false, message: 'Failed to launch', targetPath: '/some/target' };
  });

  assert.equal(result.success, false);
  assert.ok(result.message.includes('launch'));
});

test('bounceSwarm succeeds and reports both stop and launch', async () => {
  const result = await bounceSwarm('/target', 'my-run', () => {
    return { success: true, message: 'Stopped', sessionsKilled: ['coder', 'cleaner'] };
  }, async () => {
    return { success: true, message: 'Launched', targetPath: '/target' };
  });

  assert.equal(result.success, true);
  assert.ok(result.message.includes('Stopped'));
  assert.ok(result.message.includes('Launched'));
});

test('buildBounceExtensionCommand returns workbench.action.reloadWindow', () => {
  const cmd = buildBounceExtensionCommand();
  assert.equal(cmd, 'workbench.action.reloadWindow');
});

test('bounceSwarm fails only when the launch fails, even after failed stop', async () => {
  const result = await bounceSwarm('/nonexistent/target', 'test-run', () => {
    return { success: false, message: 'No socket', sessionsKilled: [] };
  }, async () => {
    return { success: false, message: 'spawn error', targetPath: '/nonexistent/target' };
  });
  assert.equal(result.success, false);
  assert.ok(result.message.includes('failed to launch'));
});

// --- idempotent stop (BL fix: bounce must work on a dead swarm) ---
const os = require('node:os');
const { stopSwarm, clearSwarmStateFiles } = require('../out/swarm/swarmStopper');

test('stopSwarm on a target with no swarm state is a success (idempotent)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-stop-'));
  const result = stopSwarm(dir);
  assert.equal(result.success, true);
  assert.equal(result.sessionsKilled.length, 0);
});

test('stopSwarm clears stale tmux-socket and sessions.tsv from a crashed run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-stop-'));
  const state = path.join(dir, '.swarmforge');
  fs.mkdirSync(state, { recursive: true });
  const socketFile = path.join(state, 'tmux-socket');
  const sessionsFile = path.join(state, 'sessions.tsv');
  fs.writeFileSync(socketFile, path.join(dir, 'no-such-socket') + '\n');
  fs.writeFileSync(sessionsFile, '1\tcoder\tcoder\tCoder\tclaude\n');

  const result = stopSwarm(dir);

  assert.equal(result.success, true);
  assert.equal(fs.existsSync(socketFile), false, 'stale tmux-socket removed');
  assert.equal(fs.existsSync(sessionsFile), false, 'stale sessions.tsv removed');
});

test('clearSwarmStateFiles is safe when files are absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-clear-'));
  assert.doesNotThrow(() => clearSwarmStateFiles(dir));
});
