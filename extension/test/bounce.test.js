const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
  bounceSwarm,
  buildBounceExtensionCommand,
} = require('../out/swarm/bouncer');

test('bounceSwarm returns error if stopSwarm fails', async () => {
  const result = await bounceSwarm('/nonexistent/target', 'test-run', () => {
    return { success: false, message: 'No tmux socket', sessionsKilled: [] };
  }, async () => {
    return { success: true, message: 'Launched', targetPath: '/nonexistent/target' };
  });

  assert.equal(result.success, false);
  assert.ok(result.message.includes('stop'));
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

test('bounceAll returns error if stopSwarm fails', async () => {
  const result = await bounceSwarm('/nonexistent/target', 'test-run', () => {
    return { success: false, message: 'No socket', sessionsKilled: [] };
  });
  assert.equal(result.success, false);
});
