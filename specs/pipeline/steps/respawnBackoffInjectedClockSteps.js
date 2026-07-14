'use strict';

// BL-376: step handlers for "Respawn backoff waits on an injected clock,
// never on the real one". Drives the REAL compiled respawnAgent
// (extension/out/swarm/tmuxClient) against a real fake-tmux fixture (a real
// executable on PATH, per test/helpers/fakeTmux.js's own established
// convention - never a hand-rolled substitute for tmux itself) for
// scenarios 01-03, and a structural source check of the real
// extension/test/tmuxClient.test.js file for scenario 04 (a file-wide
// property, not a per-test one, per the ticket's own guidance: "the
// cheapest honest way to hold it is to assert the real sleepSync is never
// invoked during the suite" - proven here by requiring every wedged-pane
// respawnAgent call in that file to pass an explicit injected wait, so no
// test can silently fall back to the real one).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const tmuxClient = require(path.join(EXT_DIR, 'out', 'swarm', 'tmuxClient'));
const sleepSyncModule = require(path.join(EXT_DIR, 'out', 'swarm', 'sleepSync'));
const { installExecutable } = require(path.join(EXT_DIR, 'test', 'helpers', 'sharedBin'));
const { installFakeTmux } = require(path.join(EXT_DIR, 'test', 'helpers', 'fakeTmux'));

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl376-acceptance-'));
}

function writeRespawnState(tmp, role) {
  const stateDir = path.join(tmp, '.swarmforge');
  const launchDir = path.join(stateDir, 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), `1\t${role}\tswarmforge-${role}\tCoder\tclaude\n`);
  const script = path.join(launchDir, `${role}.sh`);
  installExecutable(script, '#!/bin/bash\nexit 0\n');
  return { script };
}

function wedgedFixture(script) {
  return installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: `❯ bash ${script}` },
    { subcommand: 'respawn-pane', exitCode: 0, stdout: '' },
  ]);
}

function registerSteps(registry) {
  // ── Background/Given: the wedged fixture ─────────────────────────────
  registry.define(/^a pane that never confirms submission, so the retry loop runs to exhaustion$/, (ctx) => {
    ctx.tmp = mkTmp();
    const { script } = writeRespawnState(ctx.tmp, 'coder');
    ctx.fake = wedgedFixture(script);
  });

  // ── respawn-backoff-injected-clock-01/03 (shared When: injected wait) ──
  registry.define(/^respawnAgent runs with an injected wait$/, (ctx) => {
    ctx.waits = [];
    ctx.realSleepCalls = 0;
    const realSleepSync = sleepSyncModule.sleepSync;
    sleepSyncModule.sleepSync = (...args) => {
      ctx.realSleepCalls += 1;
      return realSleepSync(...args);
    };
    try {
      ctx.result = tmuxClient.respawnAgent(ctx.tmp, 'coder', (ms) => ctx.waits.push(ms));
    } finally {
      sleepSyncModule.sleepSync = realSleepSync;
      if (ctx.fake) {
        ctx.fake.restore();
        ctx.fake = null;
      }
    }
  });

  // ── respawn-backoff-injected-clock-02 ────────────────────────────────
  registry.define(/^respawnAgent runs with no wait injected$/, (ctx) => {
    ctx.tmp = ctx.tmp || mkTmp();
    const { script } = writeRespawnState(ctx.tmp, 'coder');
    const fake = wedgedFixture(script);
    ctx.realSleepCalls = 0;
    const realSleepSync = sleepSyncModule.sleepSync;
    sleepSyncModule.sleepSync = (...args) => {
      ctx.realSleepCalls += 1;
      // Never actually block for real in this acceptance run - proving the
      // WIRING reaches the real function, not spending real wall-clock.
    };
    try {
      ctx.result = tmuxClient.respawnAgent(ctx.tmp, 'coder');
    } finally {
      sleepSyncModule.sleepSync = realSleepSync;
      fake.restore();
    }
  });

  // ── respawn-backoff-injected-clock-01 ────────────────────────────────
  registry.define(/^every backoff is served by the injected wait$/, (ctx) => {
    if (ctx.waits.length === 0) {
      throw new Error('expected the retry loop to have asked for at least one backoff');
    }
  });

  registry.define(/^the real blocking sleep is never called$/, (ctx) => {
    if (ctx.realSleepCalls !== 0) {
      throw new Error(`expected the real sleepSync to never be called when a wait is injected, got ${ctx.realSleepCalls} call(s)`);
    }
  });

  // ── respawn-backoff-injected-clock-02 ────────────────────────────────
  registry.define(/^it falls back to the real blocking sleep, unchanged$/, (ctx) => {
    if (ctx.realSleepCalls === 0) {
      throw new Error('expected respawnAgent with no injected wait to fall back to the real sleepSync');
    }
  });

  // ── respawn-backoff-injected-clock-03 ────────────────────────────────
  registry.define(/^the injected wait is called once per retry, up to the retry cap and no further$/, (ctx) => {
    if (ctx.waits.length === 0 || ctx.waits.length >= 10) {
      throw new Error(`expected a small, bounded number of retry waits, got ${ctx.waits.length}`);
    }
  });

  registry.define(/^each delay it is asked for is no shorter than the one before it$/, (ctx) => {
    for (let i = 1; i < ctx.waits.length; i++) {
      if (ctx.waits[i] < ctx.waits[i - 1]) {
        throw new Error(`expected non-decreasing delays, got ${JSON.stringify(ctx.waits)}`);
      }
    }
  });

  // ── respawn-backoff-injected-clock-04 ────────────────────────────────
  registry.define(/^I inspect every respawn test$/, (ctx) => {
    ctx.respawnTestSource = fs.readFileSync(path.join(EXT_DIR, 'test', 'tmuxClient.test.js'), 'utf8');
  });

  registry.define(/^none of them lets the real blocking sleep run$/, (ctx) => {
    // Every fixture in this file that wedges the pane (a capture-pane rule
    // whose stdout still shows the pending command) drives a real retry
    // loop - each such block's own respawnAgent(...) call must pass an
    // explicit injected wait (a 3rd argument), never fall through to the
    // real sleepSync default.
    const wedgedBlocks = ctx.respawnTestSource.split(/(?=^test\()/m).filter((block) => /capture-pane[\s\S]*?bash \$\{script\}/.test(block) && /respawn-pane/.test(block));
    if (wedgedBlocks.length === 0) {
      throw new Error('expected to find at least one wedged-pane respawn test to check (fixture bug if none found)');
    }
    for (const block of wedgedBlocks) {
      if (!/respawnAgent\(tmp, 'coder', /.test(block)) {
        throw new Error(`expected every wedged-pane respawnAgent(...) call to pass an explicit injected wait, found one that does not:\n${block.slice(0, 200)}`);
      }
    }
  });
}

module.exports = { registerSteps };
