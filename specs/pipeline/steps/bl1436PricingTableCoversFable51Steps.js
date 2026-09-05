'use strict';

// BL-1436: step handlers for "the pricing table prices every model the
// swarm runs". Drives the REAL compiled pricingTable.js (never a
// reimplementation), the REAL modelDisplayName map, the parcel's own
// pricingTable.ts source text (for the comment scenario 03 checks), and
// backlog/standing-reds.tsv - a read-only live-tree read, per the
// feature's own header, justified because the roster and the register at
// this commit are the contract.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(REPO_ROOT, 'extension', 'out', 'metrics', 'pricingTable.js');
const SRC = path.join(REPO_ROOT, 'extension', 'src', 'metrics', 'pricingTable.ts');
const DISPLAY_NAME_OUT = path.join(REPO_ROOT, 'extension', 'out', 'swarm', 'modelDisplayName.js');
const STANDING_REDS = path.join(REPO_ROOT, 'backlog', 'standing-reds.tsv');

const FEATURE = 'BL-1436 The pricing table prices every model the swarm runs';

const MODEL = 'claude-fable-5-1';

const KNOWN_CATEGORIES = new Map([
  ['input', 'inputTokens'],
  ['output', 'outputTokens'],
  ['cache-read', 'cacheReadTokens'],
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

  // ── Scenario 02 (Outline) ─────────────────────────────────────────────
  scoped(/^a usage of one million (input|output|cache-read) tokens on claude-fable-5-1 and nothing else$/, (ctx, category) => {
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
  scoped(/^the claude-fable-5-1 entry in the pricing table is read$/, (ctx) => {
    const src = fs.readFileSync(SRC, 'utf8');
    const idx = src.indexOf("'claude-fable-5-1':");
    assert.ok(idx >= 0, 'expected a claude-fable-5-1 entry in pricingTable.ts');
    // The comment immediately preceding the entry line - back up to the
    // nearest blank line or the start of the surrounding comment block.
    const before = src.slice(0, idx);
    const commentStart = before.lastIndexOf('\n\n');
    ctx.entryComment = before.slice(commentStart + 1);
  });

  scoped(/^a comment beside it names the published pricing source and the date it was read$/, (ctx) => {
    assert.ok(/reference|pricing page|published/i.test(ctx.entryComment),
      `expected the comment to name a pricing source, got: ${ctx.entryComment}`);
    assert.ok(/\d{4}-\d{2}-\d{2}/.test(ctx.entryComment),
      `expected the comment to name a date it was read, got: ${ctx.entryComment}`);
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^the display-name map and backlog\/standing-reds\.tsv are read at the parcel commit$/, (ctx) => {
    ctx.displayNames = loadDisplayNames();
    ctx.standingReds = fs.readFileSync(STANDING_REDS, 'utf8');
  });

  scoped(/^claude-fable-5-1 renders as Fable 5\.1$/, (ctx) => {
    assert.equal(ctx.displayNames.formatModelDisplayName(MODEL), 'Fable 5.1',
      `expected Fable 5.1, got: ${ctx.displayNames.formatModelDisplayName(MODEL)}`);
  });

  scoped(/^no register row names pricingTable\.test\.js$/, (ctx) => {
    assert.ok(!ctx.standingReds.includes('pricingTable.test.js'),
      `expected no standing-red row for pricingTable.test.js, got:\n${ctx.standingReds}`);
  });
}

module.exports = { registerSteps };
