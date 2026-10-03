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

// 'open' when the ticket's YAML is in backlog/active or backlog/paused,
// 'done' when it is anywhere under backlog/done (milestone folders at any
// depth), null when it is in neither - or in both, which is no state the
// invariant names (BL-1860 review). A ticket file is `<id>.yaml` or
// `<id>-<slug>.yaml`, never a longer id such as `<id>0-...`.
function ticketState(id, root = REPO_ROOT) {
  const isTicket = (f) => f === `${id}.yaml` || (f.startsWith(`${id}-`) && f.endsWith('.yaml'));
  const named = (dir) => {
    try {
      return fs.readdirSync(dir).some(isTicket);
    } catch {
      return false;
    }
  };
  const namedUnder = (dir) => {
    if (named(dir)) return true;
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .some((e) => e.isDirectory() && namedUnder(path.join(dir, e.name)));
    } catch {
      return false;
    }
  };
  const open = ['active', 'paused'].some((d) => named(path.join(root, 'backlog', d)));
  const done = namedUnder(path.join(root, 'backlog', 'done'));
  if (open && done) return null;
  if (open) return 'open';
  if (done) return 'done';
  return null;
}

const REGISTER_NEEDLES = ['pricingTable.test.js', 'BL-1436-the-pricing-table-prices-every-model-the-swarm-runs.feature'];

// Pure: whether the register (standing-reds.tsv text) is right for BL-1712's
// state. Open: a row names each file and BL-1712 owns it. Done: no row names
// either. Any other state fails. Returns { ok, reason }.
function registerRowsVerdict(state, standingRedsText) {
  const rows = String(standingRedsText || '')
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split('\t'));
  const rowFor = (needle) => rows.find((cols) => (cols[1] || '').includes(needle));
  if (state === 'done') {
    for (const needle of REGISTER_NEEDLES) {
      const row = rowFor(needle);
      if (row) return { ok: false, reason: `BL-1712 is done, so no register row may name ${needle}, got: ${row.join('\t')}` };
    }
    return { ok: true };
  }
  if (state !== 'open') return { ok: false, reason: 'expected BL-1712 in exactly one of backlog/active, backlog/paused or backlog/done' };
  for (const needle of REGISTER_NEEDLES) {
    const row = rowFor(needle);
    if (!row) return { ok: false, reason: `expected a register row naming ${needle}` };
    if (row[2] !== 'BL-1712') return { ok: false, reason: `expected ${needle}'s row owned by BL-1712, got: ${row[2]}` };
  }
  return { ok: true };
}

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
    /^the register rows naming pricingTable\.test\.js and the BL-1436 feature file are owned by BL-1712 while it is open and gone once it is done$/,
    (ctx) => {
      // BL-1860: the land retires every row its ticket owns (BL-1631), so
      // the feature outlives the rows. Which state holds depends on where
      // BL-1712's own YAML sits in this tree.
      const verdict = registerRowsVerdict(ticketState('BL-1712'), ctx.standingReds);
      assert.ok(verdict.ok, `${verdict.reason}\n${ctx.standingReds}`);
    }
  );
}

module.exports = { registerSteps, ticketState, registerRowsVerdict, REGISTER_NEEDLES };
