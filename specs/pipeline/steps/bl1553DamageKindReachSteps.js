'use strict';

// BL-1553: step handlers for "the bl1364 property constructs each damage
// kind". Scenarios 01/02 drive the REAL property file under the REAL
// properties config, reading its own printed reach line - never a
// reimplementation of it (BL-233, BL-1371). Scenario 03 reads the REAL test
// source to confirm the per-kind reach-floor assertions are still present,
// never a restatement of what they assert.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { lazy } = require('./lib/lazy');

const FEATURE = 'BL-1553 The bl1364 property constructs each damage kind';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const PROPERTY_TEST_REL = 'test/bl1364TurnProfileSeriesInvariants.property.test.js';
const PROPERTY_TEST_ABS = path.join(EXTENSION_DIR, PROPERTY_TEST_REL);

const REACH_LINE_RE = /BL-1553 invariant 2 reach over \d+ draws: (\{[^\n]*\})/;

const KIND_ASSERTION_RE = {
  interior: /seen\.interior\s*>=\s*1/,
  missing: /seen\.missing\s*>=\s*1/,
  unreadablePath: /seen\.unreadablePath\s*>=\s*1/,
};

const runProperty = lazy(() =>
  spawnSync('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', PROPERTY_TEST_REL], {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
    timeout: 600000,
  })
);

function state(ctx) {
  if (!ctx.bl1553run) {
    const result = runProperty();
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    const reachMatch = REACH_LINE_RE.exec(output);
    ctx.bl1553run = {
      result,
      output,
      reach: reachMatch ? JSON.parse(reachMatch[1]) : null,
    };
  }
  return ctx.bl1553run;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01: the property file, run alone, is green ──────────────────
  scoped(
    /^extension\/test\/bl1364TurnProfileSeriesInvariants\.property\.test\.js runs alone under the properties config$/,
    (ctx) => {
      state(ctx);
    }
  );

  scoped(/^every test in it passes$/, (ctx) => {
    const s = state(ctx);
    assert.equal(s.result.status, 0, `bl1364 property file did not pass:\n${s.output.slice(-4000)}`);
  });

  // ── Scenario 02: the run's own printed reach map ──────────────────────────
  scoped(/^the run prints a reach map for invariant 2$/, (ctx) => {
    const s = state(ctx);
    assert.ok(s.reach, `no "BL-1553 invariant 2 reach over N draws:" line in the run's output:\n${s.output.slice(-4000)}`);
  });

  scoped(/^that reach map counts interior, missing and unreadablePath at least once each$/, (ctx) => {
    const s = state(ctx);
    for (const kind of ['interior', 'missing', 'unreadablePath']) {
      assert.ok((s.reach[kind] || 0) >= 1, `reach map counted ${kind} ${s.reach[kind] || 0} < 1: ${JSON.stringify(s.reach)}`);
    }
  });

  scoped(/^the three counts in that reach map sum to at least 15$/, (ctx) => {
    const s = state(ctx);
    const total = (s.reach.interior || 0) + (s.reach.missing || 0) + (s.reach.unreadablePath || 0);
    assert.ok(total >= 15, `reach map counts sum to ${total} < 15: ${JSON.stringify(s.reach)}`);
  });

  // ── Scenario 03: the reach-floor assertions are still present in source ──
  scoped(/^the source of extension\/test\/bl1364TurnProfileSeriesInvariants\.property\.test\.js is read$/, (ctx) => {
    ctx.bl1553source = fs.readFileSync(PROPERTY_TEST_ABS, 'utf8');
  });

  scoped(/^it still asserts that (.+) was generated at least once$/, (ctx, kind) => {
    const re = KIND_ASSERTION_RE[kind];
    if (!re) {
      throw new Error(`unknown kind example value: "${kind}"`);
    }
    assert.ok(
      re.test(ctx.bl1553source),
      `bl1364 property source no longer asserts a reach floor for "${kind}" (expected to match ${re})`
    );
  });
}

module.exports = { registerSteps };
