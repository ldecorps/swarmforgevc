'use strict';

// BL-1217: step handlers for "RC repair gates on the effective config, not
// only the persisted launch script". Drives the REAL
// remote_control_health_lib.bb (check-role/actionable?/expected-rc-name)
// via specs/pipeline/steps/lib/bl1217RcConfigGateCli.bb, which wires the
// exact same shared predicate every real repair path (swarm_ensure.bb,
// remote_control_health.bb, remote_control_respawn.bb) already routes
// through - no reimplementation.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'RC repair gates on the effective config, not only the persisted launch script';

const CLI = path.join(__dirname, 'lib', 'bl1217RcConfigGateCli.bb');

const OBSERVED_TO_SHAPE = {
  'a live agent that lost its remote-control flag': 'degraded',
  'a live agent whose footer reports the session dead': 'session-dead',
  'an agent that is not running at all': 'down',
};

function mkFixtureRoot() {
  return fs.realpathSync(mkSocketFixtureRoot('bl1217-acceptance-'));
}

function cleanupFixtureRoot(ctx) {
  const st = ctx.bl1217;
  if (!st || !st.root) return;
  releaseSocketFixtureRoot(st.root);
  fs.rmSync(st.root, { recursive: true, force: true });
  ctx.bl1217 = null;
}

function runGate(root, configValue, observedShape) {
  const out = execFileSync('bb', [CLI, root, configValue, observedShape], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a pack whose Claude window lines name an explicit remote-control flag$/, (ctx) => {
    ctx.bl1217 = { root: mkFixtureRoot() };
  });

  scoped(/^a persisted launch script for role "coder" that still carries that flag$/, () => {
    // Declarative - the CLI driver always writes coder.sh with an explicit
    // --remote-control flag; the Background text names the exact fixture
    // shape this whole feature depends on.
  });

  scoped(/^the pack config sets remote control to "(on|off)"$/, (ctx, value) => {
    ctx.bl1217.configValue = value;
  });

  scoped(/^the pack config names no remote control setting$/, (ctx) => {
    ctx.bl1217.configValue = 'NONE';
  });

  scoped(/^the seat "coder" is observed as "?([^"]+?)"?$/, (ctx, observed) => {
    const shape = OBSERVED_TO_SHAPE[observed.trim()];
    assert.ok(shape, `unrecognized observed shape "${observed}"`);
    ctx.bl1217.observedShape = shape;
  });

  scoped(/^a repair pass runs over that seat$/, (ctx) => {
    const st = ctx.bl1217;
    st.result = runGate(st.root, st.configValue, st.observedShape);
  });

  scoped(/^the reported status for "coder" is "([^"]+)"$/, (ctx, status) => {
    const st = ctx.bl1217;
    assert.equal(st.result.status, status, `expected status "${status}", got: ${JSON.stringify(st.result)}`);
  });

  scoped(/^no respawn is attempted for "coder"$/, (ctx) => {
    const st = ctx.bl1217;
    assert.equal(st.result.actionable, false, `expected no respawn to be attempted, got: ${JSON.stringify(st.result)}`);
  });

  scoped(/^a respawn is attempted for "coder"$/, (ctx) => {
    const st = ctx.bl1217;
    try {
      assert.equal(st.result.actionable, true, `expected a respawn to be attempted, got: ${JSON.stringify(st.result)}`);
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  scoped(/^the repair pass reports success$/, (ctx) => {
    const st = ctx.bl1217;
    try {
      // :off is a healthy terminal state (constraint: "config off must not
      // be reported as a fault") - actionable false + a real status (never
      // an error/exception) IS the success report.
      assert.equal(st.result.status, 'off');
      assert.equal(st.result.actionable, false);
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  // ── scenario 02/03: config on / absent preserve today's repair ──────────
  // "the reported status for "coder" is "<status>"" is already registered
  // above (scenario 01's generic handler) and covers these scenarios too.

  scoped(/^the report exits successfully$/, () => {
    // Covered directly by scenario 04's own final assertion below - this
    // step is declarative (the CLI driver never throws for a config-off
    // health read; a thrown exception would already have failed the
    // preceding "a health report runs without repair" step).
  });

  // ── scenario 04: a switched-off seat is healthy, not a fault ────────────

  scoped(/^a health report runs without repair$/, (ctx) => {
    const st = ctx.bl1217;
    st.result = runGate(st.root, st.configValue, st.observedShape);
  });

  scoped(/^the report does not name "coder" as needing attention$/, (ctx) => {
    const st = ctx.bl1217;
    try {
      assert.equal(st.result.status, 'off');
      assert.equal(st.result.actionable, false, 'a config-off seat must never be named as needing attention');
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  // ── scenario 05: every repair path shares the one gate ──────────────────

  scoped(/^each available repair entry point runs over that seat in turn$/, (ctx) => {
    const st = ctx.bl1217;
    // check-role/actionable? (swarm_ensure.bb, remote_control_health.bb)
    // and expected-rc-name (remote_control_respawn.bb's own direct call) -
    // the two distinct entry-point shapes named in the ticket's own How
    // section. Both come back from the SAME CLI call since it reports both.
    st.result = runGate(st.root, st.configValue, st.observedShape);
  });

  scoped(/^no repair entry point attempts a respawn for "coder"$/, (ctx) => {
    const st = ctx.bl1217;
    try {
      assert.equal(st.result.actionable, false, `check-role/actionable? entry point: expected no respawn, got: ${JSON.stringify(st.result)}`);
      assert.equal(st.result.expectedRcName, null, `expected-rc-name entry point (remote_control_respawn.bb): expected nil, got: ${JSON.stringify(st.result)}`);
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });
}

module.exports = { registerSteps };
