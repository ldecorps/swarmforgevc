'use strict';

// BL-627: pricing table corrected rates + fail-loud coverage invariant.
// Drives the REAL compiled pricingTable.js — never a reimplementation.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(REPO_ROOT, 'extension', 'out', 'metrics', 'pricingTable.js');

const FEATURE = 'pricing table carries correct rates and a fail-loud coverage invariant';

// Prior table version before BL-627's rate corrections / opus-5 add.
const PRIOR_PRICING_TABLE_VERSION = 1;

const EXPECTED_RATES = {
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-opus-5': { input: 5, output: 25 },
};

function parseDollarRate(text) {
  const m = String(text).trim().match(/^\$(\d+(?:\.\d+)?)$/);
  if (!m) throw new Error(`expected a $N rate literal, got: ${text}`);
  return Number(m[1]);
}

function loadPricing() {
  return require(OUT);
}

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function registerSteps(registry) {
  // ── corrected-rate-per-model-01 ──────────────────────────────────────────
  scoped(registry, /^PRICING_TABLE_VERSION is bumped from its prior value$/, () => {
    const { PRICING_TABLE_VERSION } = loadPricing();
    if (!(PRICING_TABLE_VERSION > PRIOR_PRICING_TABLE_VERSION)) {
      throw new Error(
        `expected PRICING_TABLE_VERSION > ${PRIOR_PRICING_TABLE_VERSION}, got ${PRICING_TABLE_VERSION}`
      );
    }
  });

  scoped(registry, /^PRICING_TABLE is read for "([^"]+)"$/, (ctx, model) => {
    const { PRICING_TABLE } = loadPricing();
    if (!EXPECTED_RATES[model]) {
      throw new Error(`unknown Examples model (not in acceptance lookup): ${model}`);
    }
    ctx.model = model;
    ctx.rates = PRICING_TABLE[model];
    if (!ctx.rates) {
      throw new Error(`PRICING_TABLE has no entry for ${model}`);
    }
  });

  scoped(
    registry,
    /^its input and output per-MTok rates are "([^"]+)" and "([^"]+)"$/,
    (ctx, inputText, outputText) => {
      const wantIn = parseDollarRate(inputText);
      const wantOut = parseDollarRate(outputText);
      const expected = EXPECTED_RATES[ctx.model];
      if (expected.input !== wantIn || expected.output !== wantOut) {
        throw new Error(
          `Examples drift for ${ctx.model}: feature says ${inputText}/${outputText}, lookup says $${expected.input}/$${expected.output}`
        );
      }
      if (ctx.rates.inputPerMTok !== wantIn || ctx.rates.outputPerMTok !== wantOut) {
        throw new Error(
          `expected ${ctx.model} rates $${wantIn}/$${wantOut}, got $${ctx.rates.inputPerMTok}/$${ctx.rates.outputPerMTok}`
        );
      }
    }
  );

  // ── unpriced-model-in-service-fails-loud-02 ─────────────────────────────
  scoped(registry, /^a fixture conf file references model "([^"]+)"$/, (ctx, model) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl627-coverage-'));
    fs.mkdirSync(path.join(root, 'swarmforge', 'packs'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'swarmforge', 'swarmforge.conf'),
      `window coder claude coder --model ${model} --dangerously-skip-permissions\n`
    );
    ctx.coverageRoot = root;
    ctx.unpricedModel = model;
  });

  scoped(registry, /^PRICING_TABLE has no entry for "([^"]+)"$/, (ctx, model) => {
    const { PRICING_TABLE } = loadPricing();
    if (PRICING_TABLE[model]) {
      throw new Error(`expected no PRICING_TABLE entry for ${model}, but found one`);
    }
    if (ctx.unpricedModel && ctx.unpricedModel !== model) {
      throw new Error(`fixture model ${ctx.unpricedModel} does not match ${model}`);
    }
  });

  scoped(registry, /^the pricing coverage check runs$/, (ctx) => {
    const { checkPricingCoverage } = loadPricing();
    const root = ctx.coverageRoot || REPO_ROOT;
    ctx.coverageResult = checkPricingCoverage(root);
  });

  scoped(registry, /^it fails$/, (ctx) => {
    if (!ctx.coverageResult || ctx.coverageResult.ok) {
      throw new Error(
        `expected coverage check to fail, got: ${JSON.stringify(ctx.coverageResult)}`
      );
    }
  });

  scoped(registry, /^the failure names "([^"]+)"$/, (ctx, model) => {
    if (!ctx.coverageResult.missing.includes(model)) {
      throw new Error(
        `expected missing to include ${model}, got: ${JSON.stringify(ctx.coverageResult.missing)}`
      );
    }
    if (!ctx.coverageResult.message.includes(model)) {
      throw new Error(`expected failure message to name ${model}, got: ${ctx.coverageResult.message}`);
    }
  });

  // ── current-roster-passes-03 ────────────────────────────────────────────
  scoped(
    registry,
    /^every model referenced by swarmforge\.conf, swarmforge\/packs\/\*\.conf, and \.swarmforge\/launch\/\*\.claude-settings\.json$/,
    (ctx) => {
      const { collectReferencedClaudeModels } = loadPricing();
      ctx.coverageRoot = REPO_ROOT;
      ctx.rosterModels = collectReferencedClaudeModels(REPO_ROOT);
      if (ctx.rosterModels.length === 0) {
        throw new Error('expected at least one bare claude-* model in the current roster sources');
      }
    }
  );

  scoped(registry, /^it passes$/, (ctx) => {
    if (!ctx.coverageResult || !ctx.coverageResult.ok) {
      throw new Error(
        `expected coverage check to pass, got: ${JSON.stringify(ctx.coverageResult)}`
      );
    }
  });
}

module.exports = { registerSteps };
