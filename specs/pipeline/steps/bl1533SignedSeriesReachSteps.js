'use strict';

// BL-1533: step handlers for "the bl604 property constructs each delta
// sign". Scenarios 01/03 drive the REAL property file under the REAL
// properties config, reading its own printed reach line - never a
// reimplementation of it. Scenario 02 drives the REAL signed-series
// generator (extension/test/helpers/signedTrendSeries.js) and the REAL
// compiled computeTrend (extension/out/metrics/trend) directly, the way the
// property file itself does.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { lazy } = require('./lib/lazy');

const FEATURE = 'BL-1533 The bl604 property constructs each delta sign';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const PROPERTY_TEST_REL = 'test/bl604TrendAnalysisInvariants.property.test.js';

const { computeTrend } = require(path.join(EXTENSION_DIR, 'out', 'metrics', 'trend'));

const KNOWN_SIGNS = new Set(['up', 'down', 'flat']);

// fast-check and the helper under test/helpers/ live in extension/node_modules
// and extension/test - neither resolves from this file's own location (the
// repo-root pipeline process), so the sample is drawn in a child process run
// WITH cwd: EXTENSION_DIR, the same real generator the property test itself
// draws from, never a restatement of it.
const SAMPLE_SCRIPT = `
const { signedSeriesArb } = require('./test/helpers/signedTrendSeries');
const fc = require('fast-check');
const [sign, count] = process.argv.slice(1);
process.stdout.write(JSON.stringify(fc.sample(signedSeriesArb(sign), Number(count))));
`;

function sampleSignedSeries(sign, count) {
  const result = spawnSync('node', ['-e', SAMPLE_SCRIPT, sign, String(count)], {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(result.status, 0, `sampling signedSeriesArb(${sign}) failed:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

const REACH_LINE_RE = /BL-1533 invariant 1 reach: (\{[^\n]*\})/;

const runProperty = lazy(() =>
  spawnSync('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', PROPERTY_TEST_REL], {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
    timeout: 600000,
  })
);

function state(ctx) {
  if (!ctx.bl1533run) {
    const result = runProperty();
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    const reachMatch = REACH_LINE_RE.exec(output);
    ctx.bl1533run = {
      result,
      output,
      reach: reachMatch ? JSON.parse(reachMatch[1]) : null,
    };
  }
  return ctx.bl1533run;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01: the property file, run alone, is green ──────────────────
  scoped(
    /^extension\/test\/bl604TrendAnalysisInvariants\.property\.test\.js runs alone under the properties config$/,
    (ctx) => {
      state(ctx);
    }
  );

  scoped(/^every test in it passes$/, (ctx) => {
    const s = state(ctx);
    assert.equal(s.result.status, 0, `bl604 property file did not pass:\n${s.output.slice(-4000)}`);
  });

  // ── Scenario 02: the signed-series generator, sampled directly ──────────
  scoped(/^(\d+) series are sampled from the signed-series generator for sign (.+)$/, (ctx, countText, sign) => {
    if (!KNOWN_SIGNS.has(sign)) {
      throw new Error(`unknown sign example value: "${sign}"`);
    }
    ctx.bl1533 = ctx.bl1533 || {};
    ctx.bl1533.sign = sign;
    ctx.bl1533.samples = sampleSignedSeries(sign, Number(countText));
  });

  scoped(/^computeTrend reports direction (.+) for every sampled series$/, (ctx, sign) => {
    if (!KNOWN_SIGNS.has(sign)) {
      throw new Error(`unknown sign example value: "${sign}"`);
    }
    assert.equal(ctx.bl1533.sign, sign, `scenario asked about ${sign} but samples were drawn for ${ctx.bl1533.sign}`);
    for (const points of ctx.bl1533.samples) {
      const own = computeTrend(points);
      assert.equal(
        own.direction,
        sign,
        `signedSeriesArb(${sign}) sampled a series whose own direction is ${own.direction}`
      );
    }
  });

  scoped(/^every sampled series has between 2 and 8 points$/, (ctx) => {
    for (const points of ctx.bl1533.samples) {
      assert.ok(
        points.length >= 2 && points.length <= 8,
        `sampled series has ${points.length} points, expected between 2 and 8`
      );
    }
  });

  // ── Scenario 03: the run's own printed reach map ──────────────────────────
  scoped(/^the run prints a reach map for invariant 1$/, (ctx) => {
    const s = state(ctx);
    assert.ok(s.reach, `no "BL-1533 invariant 1 reach:" line in the run's output:\n${s.output.slice(-4000)}`);
  });

  scoped(/^that reach map counts up at least 10 times and down at least 10 times$/, (ctx) => {
    const s = state(ctx);
    assert.ok((s.reach.up || 0) >= 10, `reach map counted up ${s.reach.up || 0} < 10: ${JSON.stringify(s.reach)}`);
    assert.ok(
      (s.reach.down || 0) >= 10,
      `reach map counted down ${s.reach.down || 0} < 10: ${JSON.stringify(s.reach)}`
    );
  });
}

module.exports = { registerSteps };
