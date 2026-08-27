'use strict';

// BL-768: step handlers for "The bounce-key pair generator reaches every
// near-collision it claims to test". Drives the REAL
// extension/test/support/bounceKeyPairArb.js - the same module
// bounceNaturalKey.property.test.js consumes (required_wiring) - via
// fast-check's own `fc.sample`, never a hand-rolled re-implementation.

const path = require('node:path');
const fc = require(path.join(__dirname, '..', '..', '..', 'extension', 'node_modules', 'fast-check'));
const {
  pairArb,
  classifyPair,
  assertPairCoverage,
  CATEGORY_NAMES,
} = require('../../../extension/test/support/bounceKeyPairArb');

const FEATURE_NAME = 'The bounce-key pair generator reaches every near-collision it claims to test';

// Fixed seeds so this acceptance suite is itself deterministic and
// reproducible - the whole point of BL-768 is that coverage no longer
// depends on which seed happened to come up.
const SCENARIO_01_SEED = 76800100;
const SCENARIO_02_BASE_SEED = 76800200;
const SCENARIO_03_SEED = 76800300;

function seenCategoriesFor(pairs) {
  const seen = new Set();
  for (const [a, b] of pairs) {
    for (const name of classifyPair(a, b)) {
      seen.add(name);
    }
  }
  return seen;
}

function registerSteps(registry) {
  registry.defineScoped(
    /^the bounce-key pair generator$/,
    () => {
      // No-op: pairArb is imported once at module load. Nothing to seed.
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^(\d+) pairs are sampled$/,
    (ctx, count) => {
      ctx.samples = fc.sample(pairArb, { numRuns: Number(count), seed: SCENARIO_01_SEED });
      ctx.seen = seenCategoriesFor(ctx.samples);
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the "([^"]+)" category is reached$/,
    (ctx, category) => {
      if (!ctx.seen.has(category)) {
        throw new Error(`expected the "${category}" category to be reached among ${ctx.samples.length} sampled pairs, but it was not`);
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^(\d+) pairs are sampled with each of (\d+) different seeds$/,
    (ctx, count, seedCount) => {
      ctx.perSeedSeen = [];
      for (let i = 0; i < Number(seedCount); i++) {
        const pairs = fc.sample(pairArb, { numRuns: Number(count), seed: SCENARIO_02_BASE_SEED + i });
        ctx.perSeedSeen.push({ seed: SCENARIO_02_BASE_SEED + i, seen: seenCategoriesFor(pairs) });
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^every category is reached in every sample$/,
    (ctx) => {
      const failures = [];
      for (const { seed, seen } of ctx.perSeedSeen) {
        const missed = CATEGORY_NAMES.filter((c) => !seen.has(c));
        if (missed.length > 0) {
          failures.push(`seed ${seed} missed: ${missed.join(', ')}`);
        }
      }
      if (failures.length > 0) {
        throw new Error(`coverage depended on seed after all - ${failures.join(' | ')}`);
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^a sample in which no pair differs only in time-of-day$/,
    (ctx) => {
      const excludedCategory = 'differs only in time-of-day';
      const drawn = fc.sample(pairArb, { numRuns: 200, seed: SCENARIO_03_SEED });
      ctx.sample = drawn.filter(([a, b]) => !classifyPair(a, b).includes(excludedCategory));
      if (ctx.sample.length === drawn.length) {
        throw new Error('fixture error: the drawn sample never contained the excluded category to begin with');
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the coverage guard runs over that sample$/,
    (ctx) => {
      const seen = seenCategoriesFor(ctx.sample);
      try {
        assertPairCoverage(seen);
        ctx.guardError = null;
      } catch (err) {
        ctx.guardError = err;
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^it fails naming "([^"]+)"$/,
    (ctx, category) => {
      if (!ctx.guardError) {
        throw new Error('expected the coverage guard to fail, but it passed');
      }
      if (!ctx.guardError.message.includes(category)) {
        throw new Error(`expected the failure to name "${category}", got: ${ctx.guardError.message}`);
      }
    },
    FEATURE_NAME,
  );
}

module.exports = { registerSteps };
