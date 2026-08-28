'use strict';

// BL-1247: step handlers for "the master-main reconcile sweep can be
// switched off, and off means it writes nothing". Drives the REAL
// handoffd.bb end to end (never a reimplementation) via its
// --reconcile-sweep-once one-shot flag (same posture as the pre-existing
// --sweep-once/--chase-sweep-once) against a real fixture repo with local
// main genuinely diverged two ways from a real origin remote - see
// lib/bl1247ReconcileSweepKillSwitchCli.sh.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'the master-main reconcile sweep can be switched off, and off means it writes nothing';

const CLI = path.join(__dirname, 'lib', 'bl1247ReconcileSweepKillSwitchCli.sh');

function runCli(mode, param) {
  const args = [CLI, mode];
  if (param) args.push(param);
  const out = execFileSync('bash', args, { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^local main has diverged two ways from origin\/main$/, (ctx) => {
    ctx.bl1247 = {};
  });

  scoped(/^the divergence carries local commits that origin does not have$/, () => {
    // Established by the CLI fixture itself (a real committed local-only
    // commit) - nothing to stash in ctx, the fixture is built fresh per
    // CLI invocation below.
  });

  scoped(/^the reconcile switch is "?([a-z]+)"?$/, (ctx, setting) => {
    ctx.bl1247.setting = setting;
  });

  scoped(/^the reconcile sweep tick fires$/, (ctx) => {
    const st = ctx.bl1247;
    // Scenario 04 already fired both ticks (on, then off) inside the
    // "switch is turned off with the daemon left running" step - this
    // step there is flavor text confirming a tick fired, not a second
    // separate invocation.
    if (st.toggleResult) return;
    if (st.setting) {
      st.matrixResult = runCli('matrix', st.setting);
    }
  });

  scoped(/^the sweep (runs|does not run)$/, (ctx, outcome) => {
    const st = ctx.bl1247;
    const expectRan = outcome === 'runs';
    if (st.toggleResult) {
      assert.equal(st.toggleResult.ranWhenOn, true, `expected the earlier on-tick to have run, got: ${JSON.stringify(st.toggleResult)}`);
      assert.equal(st.toggleResult.ranWhenOff, expectRan, `expected the switched tick's ran to be ${expectRan}, got: ${JSON.stringify(st.toggleResult)}`);
      return;
    }
    assert.equal(st.matrixResult.ran, expectRan, `expected ran=${expectRan}, got: ${JSON.stringify(st.matrixResult)}`);
  });

  scoped(/^local main points at the same commit it pointed at before the tick$/, (ctx) => {
    ctx.bl1247.mainUnmovedResult = runCli('main-unmoved');
    assert.equal(ctx.bl1247.mainUnmovedResult.unmoved, true, `expected main unmoved, got: ${JSON.stringify(ctx.bl1247.mainUnmovedResult)}`);
  });

  scoped(/^every local commit that preceded the tick is still reachable from HEAD$/, (ctx) => {
    assert.equal(ctx.bl1247.mainUnmovedResult.reachable, true, `expected pre-tick commit still reachable, got: ${JSON.stringify(ctx.bl1247.mainUnmovedResult)}`);
  });

  scoped(/^the daemon records that the sweep was skipped because the switch is off$/, (ctx) => {
    ctx.bl1247.skipLogResult = runCli('skip-log');
    assert.ok(ctx.bl1247.skipLogResult.log.includes('skipped-disabled'), `expected a skipped-disabled log line, got: ${ctx.bl1247.skipLogResult.log}`);
  });

  scoped(/^the record names the divergence the sweep declined to act on$/, (ctx) => {
    const { log } = ctx.bl1247.skipLogResult;
    assert.match(log, /ahead=\d+ behind=\d+/, `expected the log to name ahead/behind counts, got: ${log}`);
  });

  scoped(/^the switch is turned off with the daemon left running$/, (ctx) => {
    ctx.bl1247.toggleResult = runCli('toggle-without-restart');
  });
}

module.exports = { registerSteps };
