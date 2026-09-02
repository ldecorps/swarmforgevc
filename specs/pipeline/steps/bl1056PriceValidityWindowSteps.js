'use strict';

// BL-1056: step handlers for "a price with an expiry date is a query, not a
// memory". Each scenario builds a pricing table of the shape the production
// table uses and drives the REAL resolution and query functions from
// extension/out/metrics/pricingTable.js - never a re-implementation of the
// window arithmetic here (a handler that recomputed the boundary would pass
// against a broken table).
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');

// One input Mtok and nothing else, so the asserted cost IS the input rate.
const ONE_INPUT_MTOK = { inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

function pricingModule() {
  return require(path.join(EXT_DIR, 'out', 'metrics', 'pricingTable.js'));
}

// Scenario Outline values are validated against what the feature declares
// rather than passed through: an instant or a model the table never heard of
// is a failure, not a silent pass.
const KNOWN_INSTANTS = ['2026-08-22', '2026-08-31', '2026-09-01', '2026-01-01'];

function instant(day) {
  if (!KNOWN_INSTANTS.includes(day)) {
    throw new Error(`unknown instant "${day}" - the Examples table and this handler have diverged`);
  }
  return new Date(`${day}T12:00:00.000Z`);
}

/** Rates whose input rate is the number the scenario names. */
function ratesAt(perInputMtok) {
  const input = Number(perInputMtok);
  if (!Number.isFinite(input)) {
    throw new Error(`"${perInputMtok}" is not a rate`);
  }
  return {
    inputPerMTok: input,
    outputPerMTok: input * 5,
    cacheCreatePerMTok: input * 1.25,
    cacheReadPerMTok: input * 0.1,
  };
}

function table(ctx) {
  if (!ctx.bl1056Table) {
    ctx.bl1056Table = {};
  }
  return ctx.bl1056Table;
}

const FEATURE_NAME = 'A price with an expiry date is a query, not a memory';

function registerSteps(registry) {
  // Scoped: "one input Mtok is costed at ..." is generic enough that an
  // unscoped registration could answer another feature's scenario with this
  // ticket's fixture table (BL-425).
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^"([^"]+)" is priced at "([^"]+)" per input Mtok until "([^"]+)", then "([^"]+)"$/,
    (ctx, model, inside, until, after) => {
      table(ctx)[model] = { ...ratesAt(inside), until, then: ratesAt(after) };
    });

  scoped(/^"([^"]+)" is priced at "([^"]+)" per input Mtok with no window$/, (ctx, model, rate) => {
    table(ctx)[model] = ratesAt(rate);
  });

  scoped(/^"([^"]+)" is priced only for instants before "([^"]+)"$/, (ctx, model, until) => {
    // `then: null` is the table's way of saying the model has no rate at all
    // after the window - the shape the fail-loud invariant is about.
    table(ctx)[model] = { ...ratesAt('2'), until, then: null };
  });

  scoped(/^"([^"]+)" has no pricing entry$/, (ctx, model) => {
    if (table(ctx)[model]) {
      throw new Error(`the fixture table already prices ${model}, so this scenario would prove nothing`);
    }
    ctx.bl1056UnpricedModel = model;
  });

  scoped(/^one input Mtok is costed at "([^"]+)"$/, (ctx, day) => {
    const model = ctx.bl1056UnpricedModel || Object.keys(table(ctx))[0];
    if (!model) {
      throw new Error('no model under test - the Given step did not run');
    }
    ctx.bl1056Cost = pricingModule().estimateCostUsdAt(ONE_INPUT_MTOK, model, instant(day), table(ctx));
  });

  scoped(/^the cost is "([^"]+)"$/, (ctx, expected) => {
    const want = Number(expected);
    if (typeof ctx.bl1056Cost !== 'number' || Math.abs(ctx.bl1056Cost - want) > 1e-9) {
      throw new Error(`expected a cost of ${want}, got ${JSON.stringify(ctx.bl1056Cost)}`);
    }
  });

  scoped(/^costing fails loud$/, (ctx) => {
    if (ctx.bl1056Cost !== null) {
      throw new Error(`expected a loud null, got ${JSON.stringify(ctx.bl1056Cost)}`);
    }
  });

  scoped(/^no cost is reported$/, (ctx) => {
    // Explicitly not zero: a 0 would read as "this was free" and is the
    // silent degradation the invariant forbids.
    if (ctx.bl1056Cost === 0) {
      throw new Error('costing reported 0, which reads as free rather than as unknown');
    }
    if (ctx.bl1056Cost !== null) {
      throw new Error(`expected no cost, got ${JSON.stringify(ctx.bl1056Cost)}`);
    }
  });

  scoped(/^the staleness query is run at "([^"]+)"$/, (ctx, day) => {
    ctx.bl1056Alerts = pricingModule().listPricingWindowAlerts(instant(day), table(ctx));
  });

  scoped(/^it names "([^"]+)"$/, (ctx, model) => {
    if (!ctx.bl1056Alerts.some((alert) => alert.model === model)) {
      throw new Error(`the staleness query did not name ${model}: ${JSON.stringify(ctx.bl1056Alerts)}`);
    }
  });

  scoped(/^it does not name "([^"]+)"$/, (ctx, model) => {
    if (ctx.bl1056Alerts.some((alert) => alert.model === model)) {
      throw new Error(`the staleness query named ${model}, which has no window to go stale`);
    }
  });

  scoped(/^it names the boundary date "([^"]+)"$/, (ctx, until) => {
    // The date must come out of the query, so nobody has to know it already.
    if (!ctx.bl1056Alerts.some((alert) => alert.until === until)) {
      throw new Error(`no alert carries the boundary ${until}: ${JSON.stringify(ctx.bl1056Alerts)}`);
    }
  });
}

module.exports = { registerSteps };
