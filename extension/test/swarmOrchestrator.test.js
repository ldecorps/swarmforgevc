const assert = require('node:assert/strict');
const {
  decideActivationPath,
  shouldSkipHandoffDaemon,
} = require('../out/swarm/swarmOrchestrator');

test('shouldSkipHandoffDaemon is true when SWARMFORGE_SKIP_DAEMON=1', () => {
  assert.equal(shouldSkipHandoffDaemon({ SWARMFORGE_SKIP_DAEMON: '1' }), true);
});

test('shouldSkipHandoffDaemon is true when SWARMFORGE_MAILBOX_ONLY=1', () => {
  assert.equal(shouldSkipHandoffDaemon({ SWARMFORGE_MAILBOX_ONLY: '1' }), true);
});

test('shouldSkipHandoffDaemon is false when daemon is expected', () => {
  assert.equal(shouldSkipHandoffDaemon({ SWARMFORGE_SKIP_DAEMON: '0' }), false);
  assert.equal(shouldSkipHandoffDaemon({}), false);
});

test('decideActivationPath reattaches when tmux and daemon are both ready', () => {
  assert.equal(
    decideActivationPath({
      tmuxReady: true,
      daemonReady: true,
      configMatches: true,
      autoLaunch: true,
      skipDaemon: false,
      hasPriorRun: true,
      isStartupTriggered: true,
    }),
    'reattach'
  );
});

test('decideActivationPath reattaches when daemon is intentionally skipped', () => {
  assert.equal(
    decideActivationPath({
      tmuxReady: true,
      daemonReady: false,
      configMatches: true,
      autoLaunch: true,
      skipDaemon: true,
      hasPriorRun: false,
      isStartupTriggered: true,
    }),
    'reattach'
  );
});

test('decideActivationPath ensures daemon before reattach when tmux is live but daemon is down', () => {
  assert.equal(
    decideActivationPath({
      tmuxReady: true,
      daemonReady: false,
      configMatches: true,
      autoLaunch: false,
      skipDaemon: false,
      hasPriorRun: true,
      isStartupTriggered: true,
    }),
    'reattach-after-daemon'
  );
});

test('decideActivationPath cold-launches on dev auto-launch when transport is not ready', () => {
  assert.equal(
    decideActivationPath({
      tmuxReady: false,
      daemonReady: false,
      configMatches: true,
      autoLaunch: true,
      skipDaemon: false,
      hasPriorRun: false,
      isStartupTriggered: true,
    }),
    'cold-launch'
  );
});

test('decideActivationPath cold-launches when tmux is ready but pack config mismatches', () => {
  assert.equal(
    decideActivationPath({
      tmuxReady: true,
      daemonReady: true,
      configMatches: false,
      autoLaunch: true,
      skipDaemon: false,
      hasPriorRun: true,
      isStartupTriggered: true,
    }),
    'cold-launch'
  );
});

test('decideActivationPath offers resume when auto-launch is off and transport is down', () => {
  assert.equal(
    decideActivationPath({
      tmuxReady: false,
      daemonReady: false,
      configMatches: true,
      autoLaunch: false,
      skipDaemon: false,
      hasPriorRun: true,
      isStartupTriggered: true,
    }),
    'resume-prompt'
  );
});

test('decideActivationPath does nothing when there is no prior run and auto-launch is off', () => {
  assert.equal(
    decideActivationPath({
      tmuxReady: false,
      daemonReady: false,
      configMatches: true,
      autoLaunch: false,
      skipDaemon: false,
      hasPriorRun: false,
      isStartupTriggered: true,
    }),
    'none'
  );
});
