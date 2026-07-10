'use strict';

// BL-207: step handlers for the normalized-provider-error-taxonomy
// feature. Drives BOTH the real compiled TS classifier
// (extension/out/swarm/providerErrorTaxonomy.js) and the real bb classifier
// (swarmforge/scripts/agent_runtime_lib.bb via classify_provider_error_
// harness.bb), asserting they agree - proving the "same categorization
// across fork orchestration and extension surfacing" gate, not just
// exercising one side.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { classifyProviderError } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'out', 'swarm', 'providerErrorTaxonomy.js')
);
const HARNESS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'test', 'classify_provider_error_harness.bb');

const ALLOWED_CATEGORIES = new Set(['launch-failed', 'auth', 'unavailable', 'protocol', 'timeout', 'unknown']);

function classifyBb(detail) {
  const out = execFileSync('bb', [HARNESS, detail], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── normalize-01 ─────────────────────────────────────────────────────
  registry.define(/^a provider-specific failure occurs during launch or interaction$/, (ctx) => {
    ctx.detail = 'No launch script found for role "coder" at /path/coder.sh';
  });

  registry.define(/^it surfaces to orchestration and operator views$/, (ctx) => {
    ctx.tsResult = classifyProviderError(ctx.detail);
    ctx.bbResult = classifyBb(ctx.detail);
  });

  registry.define(/^it is reported as one of the enumerated Forge error categories$/, (ctx) => {
    if (!ALLOWED_CATEGORIES.has(ctx.tsResult.category)) {
      throw new Error(`expected an enumerated category, got: ${ctx.tsResult.category}`);
    }
    if (ctx.tsResult.category !== ctx.bbResult.category) {
      throw new Error(
        `expected the TS and bb classifiers to agree; got ts=${ctx.tsResult.category} bb=${ctx.bbResult.category}`
      );
    }
  });

  registry.define(/^the original backend detail is attached as context$/, (ctx) => {
    if (ctx.tsResult.detail !== ctx.detail || ctx.bbResult.detail !== ctx.detail) {
      throw new Error(`expected the original detail attached unchanged, got ts=${ctx.tsResult.detail} bb=${ctx.bbResult.detail}`);
    }
  });

  // ── cross-provider-parity-02 ─────────────────────────────────────────
  registry.define(/^two different providers each hit an authentication failure$/, (ctx) => {
    ctx.detailA = 'Error: 401 Unauthorized - invalid API key provided';
    ctx.detailB = 'Authentication failed: invalid credential for this account';
  });

  registry.define(/^those failures are normalized$/, (ctx) => {
    ctx.resultA = classifyProviderError(ctx.detailA);
    ctx.resultB = classifyProviderError(ctx.detailB);
  });

  registry.define(/^both map to the same Forge error category$/, (ctx) => {
    if (ctx.resultA.category !== 'auth' || ctx.resultB.category !== 'auth') {
      throw new Error(`expected both auth failures to map to "auth", got ${ctx.resultA.category} / ${ctx.resultB.category}`);
    }
    if (ctx.resultA.category !== ctx.resultB.category) {
      throw new Error(`expected the same category for both providers, got ${ctx.resultA.category} vs ${ctx.resultB.category}`);
    }
  });

  // ── unknown-fallback-03 ──────────────────────────────────────────────
  registry.define(/^a backend error not covered by any mapping$/, (ctx) => {
    ctx.detail = 'some entirely novel provider-specific gibberish xyz123';
  });

  registry.define(/^it is normalized$/, (ctx) => {
    ctx.tsResult = classifyProviderError(ctx.detail);
    ctx.bbResult = classifyBb(ctx.detail);
  });

  registry.define(/^it is categorized as "unknown" with its raw detail attached$/, (ctx) => {
    if (ctx.tsResult.category !== 'unknown' || ctx.bbResult.category !== 'unknown') {
      throw new Error(`expected "unknown", got ts=${ctx.tsResult.category} bb=${ctx.bbResult.category}`);
    }
    if (ctx.tsResult.detail !== ctx.detail || ctx.bbResult.detail !== ctx.detail) {
      throw new Error('expected the raw detail to still be attached on the unknown fallback');
    }
  });
}

module.exports = { registerSteps };
