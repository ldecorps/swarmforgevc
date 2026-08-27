'use strict';

// BL-1007: unit-lane contention budget acceptance steps.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  effectiveBudgetMs,
  UNIT_LANE_BUDGET_CEILING_MS,
  evidenceTestsAreAttributable,
} = require('./lib/contentionBudget');

const FEATURE = 'A unit-lane test budget is relative to recorded contention';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

/** Case-exact Outline cells (BL-113 soft lock). */
const KNOWN_BASES = new Set(['20000', '45000']);
const KNOWN_FACTORS = new Set(['0.25', '1', '2', '3', '1000', 'unusable']);
const KNOWN_EFFECTIVES = new Set(['20000', '40000', '60000', '90000', 'ceiling']);
const KNOWN_ROWS = new Set([
  '20000|0.25|20000',
  '20000|1|20000',
  '20000|2|40000',
  '20000|3|60000',
  '45000|2|90000',
  '20000|1000|ceiling',
  '20000|unusable|20000',
]);

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the unit lane samples a host contention factor at run start$/, (ctx) => {
    ctx.ceilingMs = UNIT_LANE_BUDGET_CEILING_MS;
  });

  scoped(/^the lane declares an absolute ceiling for any effective budget$/, (ctx) => {
    ctx.ceilingMs = UNIT_LANE_BUDGET_CEILING_MS;
  });

  scoped(/^a unit-lane test whose base budget is (\d+) ms$/, (ctx, base) => {
    assert.ok(KNOWN_BASES.has(base), `unknown Outline base cell: ${base}`);
    ctx.baseMs = Number(base);
    ctx.baseRaw = base;
  });

  scoped(/^the recorded contention factor is (.+)$/, (ctx, raw) => {
    const cell = raw.trim();
    assert.ok(KNOWN_FACTORS.has(cell), `unknown Outline factor cell: ${cell}`);
    ctx.factorRaw = cell;
    ctx.factor = cell === 'unusable' ? 'unusable' : Number(cell);
  });

  scoped(/^its effective budget is (.+)$/, (ctx, raw) => {
    const cell = raw.trim();
    assert.ok(KNOWN_EFFECTIVES.has(cell), `unknown Outline effective cell: ${cell}`);
    const rowKey = `${ctx.baseRaw}|${ctx.factorRaw}|${cell}`;
    assert.ok(KNOWN_ROWS.has(rowKey), `unknown Outline row: ${rowKey}`);
    const expected = cell === 'ceiling' ? ctx.ceilingMs : Number(cell);
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
    // Smoke file carries an explicit timeout literal so setup wraps and
    // records loadNormalizedDurationMs (architect bounce: no all-null tests[]).
    const res = spawnSync(
      'npx',
      ['vitest', 'run', '--config', 'vitest.config.mjs', 'test/bl1007ContentionBudgetSmoke.test.js'],
      {
        cwd: path.join(REPO_ROOT, 'extension'),
        encoding: 'utf8',
        timeout: 120000,
        env: { ...process.env },
      }
    );
    ctx.unitLaneOut = `${res.stdout || ''}${res.stderr || ''}`;
    assert.equal(res.status, 0, `smoke unit lane failed:\n${ctx.unitLaneOut}`);
    const tmp = require('node:os').tmpdir();
    const files = fs
      .readdirSync(tmp)
      .filter((f) => f.startsWith('sfvc-unit-lane-budget-'))
      .map((f) => ({ f, m: fs.statSync(path.join(tmp, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    assert.ok(files.length > 0, 'expected budget evidence file');
    ctx.evidence = JSON.parse(fs.readFileSync(path.join(tmp, files[0].f), 'utf8'));
  });

  scoped(/^the run's evidence names the contention factor it applied$/, (ctx) => {
    assert.ok('contentionFactor' in ctx.evidence);
  });

  scoped(/^the run's evidence names each budgeted test's load-normalized duration$/, (ctx) => {
    assert.ok(Array.isArray(ctx.evidence.tests));
    assert.ok(ctx.evidence.tests.length > 0, 'expected at least one budgeted test');
    assert.ok('suiteEffectiveMs' in ctx.evidence);
    assert.equal(
      evidenceTestsAreAttributable(ctx.evidence.tests),
      true,
      `expected finite loadNormalizedDurationMs on every budgeted test, got: ${JSON.stringify(ctx.evidence.tests)}`
    );
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
