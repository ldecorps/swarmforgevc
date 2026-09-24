'use strict';

// BL-1712: step handlers for "the pricing table prices claude-opus-5-5".
// Drives the REAL compiled pricingTable.js (never a reimplementation), the
// REAL modelDisplayName map, and backlog/standing-reds.tsv - a read-only
// live-tree read, per the feature's own header, justified because the
// roster and the register at this commit are the contract. Unlike BL-1436,
// this feature has no source-comment scenario; scenario 03 instead checks
// the honest-null behavior for the model's unpublished cache-creation rate.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(REPO_ROOT, 'extension', 'out', 'metrics', 'pricingTable.js');
const DISPLAY_NAME_OUT = path.join(REPO_ROOT, 'extension', 'out', 'swarm', 'modelDisplayName.js');
const STANDING_REDS = path.join(REPO_ROOT, 'backlog', 'standing-reds.tsv');

const FEATURE = 'BL-1712 the pricing table prices claude-opus-5-5';

const MODEL = 'claude-opus-5-5';

const KNOWN_CATEGORIES = new Map([
  ['input', 'inputTokens'],
  ['output', 'outputTokens'],
  ['cache-read', 'cacheReadTokens'],
  ['cache-creation', 'cacheCreationTokens'],
]);

function loadPricing() {
  // Fresh read every time so a same-process recompile (npm run compile
  // between scenarios) is picked up - require's own module cache would
  // otherwise serve a stale copy across scenarios in the same test run.
  delete require.cache[require.resolve(OUT)];
  return require(OUT);
}

function loadDisplayNames() {
  delete require.cache[require.resolve(DISPLAY_NAME_OUT)];
  return require(DISPLAY_NAME_OUT);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the pricing coverage check runs over the parcel's own roster sources$/, (ctx) => {
    const { checkPricingCoverage } = loadPricing();
    ctx.coverage = checkPricingCoverage(REPO_ROOT);
  });

  scoped(/^it reports every referenced Claude model as priced$/, (ctx) => {
    assert.equal(ctx.coverage.ok, true, `expected coverage ok, got: ${ctx.coverage.message}`);
    assert.deepEqual(ctx.coverage.missing, [], `expected no missing models, got: ${JSON.stringify(ctx.coverage.missing)}`);
    // Non-vacuity: the roster this ran over actually contains the model
    // this ticket exists for, so a coverage check that silently skipped
    // the roster read would not pass this by accident.
    assert.ok(ctx.coverage.referenced.includes(MODEL),
      `expected the roster to reference ${MODEL}, got: ${JSON.stringify(ctx.coverage.referenced)}`);
  });

  // ── Scenario 02 (Outline) and Scenario 03 share this Given/When ────────
  scoped(/^a usage of one million (input|output|cache-read|cache-creation) tokens on claude-opus-5-5 and nothing else$/, (ctx, category) => {
    const field = KNOWN_CATEGORIES.get(category);
    if (!field) {
      throw new Error(`unknown <category>: ${category}`);
    }
    ctx.usage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, [field]: 1_000_000 };
  });

  scoped(/^the cost is estimated$/, (ctx) => {
    const { estimateCostUsd } = loadPricing();
    ctx.cost = estimateCostUsd(ctx.usage, MODEL);
  });

  scoped(/^it is (\d+\.\d+) dollars$/, (ctx, usd) => {
    assert.equal(ctx.cost, Number(usd), `expected $${usd}, got: ${ctx.cost}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the estimate is null$/, (ctx) => {
    assert.equal(ctx.cost, null, `expected null, got: ${ctx.cost}`);
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^the display-name map and the standing-red register are read from the parcel's own tree$/, (ctx) => {
    ctx.displayNames = loadDisplayNames();
    ctx.standingReds = fs.readFileSync(STANDING_REDS, 'utf8');
  });

  scoped(/^claude-opus-5-5 displays as "Opus 5\.5"$/, (ctx) => {
    assert.equal(ctx.displayNames.formatModelDisplayName(MODEL), 'Opus 5.5',
      `expected Opus 5.5, got: ${ctx.displayNames.formatModelDisplayName(MODEL)}`);
  });

  scoped(
    /^the register rows naming pricingTable\.test\.js and the BL-1436 feature file are both present and each names BL-1712 as its owner$/,
    (ctx) => {
      const rows = ctx.standingReds
        .split('\n')
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .map((line) => line.split('\t'));
      const rowFor = (needle) => rows.find((cols) => (cols[1] || '').includes(needle));

      const unitRow = rowFor('pricingTable.test.js');
      assert.ok(unitRow, `expected a register row naming pricingTable.test.js, got:\n${ctx.standingReds}`);
      assert.equal(unitRow[2], 'BL-1712', `expected pricingTable.test.js's row owned by BL-1712, got: ${unitRow[2]}`);

      const featureRow = rowFor('BL-1436-the-pricing-table-prices-every-model-the-swarm-runs.feature');
      assert.ok(featureRow, `expected a register row naming the BL-1436 feature, got:\n${ctx.standingReds}`);
      assert.equal(
        featureRow[2],
        'BL-1712',
        `expected the BL-1436 feature's row owned by BL-1712, got: ${featureRow[2]}`
      );
    }
  );
}

module.exports = { registerSteps };
