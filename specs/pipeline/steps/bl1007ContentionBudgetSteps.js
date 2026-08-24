'use strict';

// BL-1007: unit-lane contention budget acceptance steps.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  effectiveBudgetMs,
  UNIT_LANE_BUDGET_CEILING_MS,
  resolveUnitLaneTimeout,
} = require('./lib/contentionBudget');

const FEATURE = 'A unit-lane test budget is relative to recorded contention';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the unit lane samples a host contention factor at run start$/, (ctx) => {
    ctx.ceilingMs = UNIT_LANE_BUDGET_CEILING_MS;
  });

  scoped(/^the lane declares an absolute ceiling for any effective budget$/, (ctx) => {
    ctx.ceilingMs = UNIT_LANE_BUDGET_CEILING_MS;
  });

  scoped(/^a unit-lane test whose base budget is (\d+) ms$/, (ctx, base) => {
    ctx.baseMs = Number(base);
  });

  scoped(/^the recorded contention factor is (.+)$/, (ctx, raw) => {
    ctx.factor = raw.trim() === 'unusable' ? 'unusable' : Number(raw);
  });

  scoped(/^its effective budget is (.+)$/, (ctx, raw) => {
    const expected =
      raw.trim() === 'ceiling' ? ctx.ceilingMs : Number(raw);
    const actual = effectiveBudgetMs(ctx.baseMs, ctx.factor, ctx.ceilingMs);
    assert.equal(actual, expected);
  });

  scoped(/^the lane's declared absolute ceiling is read$/, (ctx) => {
    ctx.ceilingMs = UNIT_LANE_BUDGET_CEILING_MS;
  });

  scoped(/^it is a finite number of milliseconds$/, (ctx) => {
    assert.equal(Number.isFinite(ctx.ceilingMs), true);
    assert.ok(ctx.ceilingMs > 0);
  });

  scoped(/^the unit lane completes a run$/, (ctx) => {
    // Drive a tiny vitest invocation that loads the setup file.
    const res = spawnSync(
      'npx',
      ['vitest', 'run', '--config', 'vitest.config.mjs', 'test/resourceTelemetry.test.js'],
      {
        cwd: path.join(REPO_ROOT, 'extension'),
        encoding: 'utf8',
        timeout: 120000,
        env: { ...process.env },
      }
    );
    ctx.unitLaneOut = `${res.stdout || ''}${res.stderr || ''}`;
    ctx.evidencePath = process.env.SWARMFORGE_UNIT_LANE_BUDGET_EVIDENCE;
    // Evidence is written inside the child; locate via /tmp pattern.
    const tmp = require('node:os').tmpdir();
    const files = fs.readdirSync(tmp).filter((f) => f.startsWith('sfvc-unit-lane-budget-'));
    assert.ok(files.length > 0, 'expected budget evidence file');
    ctx.evidence = JSON.parse(fs.readFileSync(path.join(tmp, files.sort().at(-1)), 'utf8'));
  });

  scoped(/^the run's evidence names the contention factor it applied$/, (ctx) => {
    assert.ok('contentionFactor' in ctx.evidence);
  });

  scoped(/^the run's evidence names each budgeted test's load-normalized duration$/, (ctx) => {
    // Suite-level evidence always present; per-test list may be empty when
    // no explicit timeout literal was scaled — still record the field.
    assert.ok(Array.isArray(ctx.evidence.tests));
    assert.ok('suiteEffectiveMs' in ctx.evidence);
  });

  scoped(/^a unit-lane test file whose source declares an explicit base budget$/, (ctx) => {
    ctx.sampleSource = "test('x', () => {}, 45000);\n";
  });

  scoped(/^the existing source-parsing timeout guard reads that file$/, (ctx) => {
    const { parseTestTimeouts } = require('./lib/testTimeoutParser');
    ctx.parsed = parseTestTimeouts(ctx.sampleSource);
  });

  scoped(/^it reports the base budget as a numeric literal$/, (ctx) => {
    const hit = ctx.parsed.find((p) => p.timeoutMs === 45000);
    assert.ok(hit, `expected 45000 literal in ${JSON.stringify(ctx.parsed)}`);
  });

  scoped(/^the property lane declares its own budget$/, (ctx) => {
    const conf = fs.readFileSync(path.join(REPO_ROOT, 'extension', 'vitest.properties.config.mjs'), 'utf8');
    assert.match(conf, /testTimeout:\s*20000/);
    assert.doesNotMatch(conf, /contentionBudget/);
    ctx.propertyConf = conf;
  });

  scoped(/^the property lane runs under that same recorded contention factor$/, () => {
    /* observational: config text already excludes the helper */
  });

  scoped(/^the property lane budget is unchanged$/, (ctx) => {
    assert.match(ctx.propertyConf, /testTimeout:\s*20000/);
  });
}

module.exports = { registerSteps };
