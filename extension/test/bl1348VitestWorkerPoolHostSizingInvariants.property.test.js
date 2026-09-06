'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');

const { resolveVitestWorkerPool } = require('../out/tools/vitest-worker-memory-budget');

// BL-1348 declared invariants:
//   1. Both vitest lanes size their pool through the single
//      resolveVitestWorkerPool composition point: neither lane gains a
//      sizing route the other does not share (BL-935 invariant 3).
//   2. A resolved pool is never smaller than one worker, whatever the host
//      RAM and whatever the override.
//   3. The existing full-forge-on-darwin ceiling of one is unchanged by
//      this ticket.
//
// P1 (invariant 2, generative): for any host RAM, override, pack,
//    platform, rotation and defaultCeiling, the resolved pool is >= 1.
// P2 (invariant 3, generative): for any host RAM, override, rotation and
//    defaultCeiling, pack=full-forge + platform=darwin always resolves to
//    exactly 1 - unaffected by this ticket's own PER_WORKER_HEAP_MB drop
//    or the new defaultCeiling wiring.
// Invariant 1 is structural (no property-shaped domain over "which config
// file" - there are exactly two, fixed, real files): both
// vitest.config.mjs and vitest.properties.config.mjs are read and checked
// for the SAME resolveVitestWorkerPool call shape, including the new
// defaultCeiling: os.cpus().length this ticket adds to both.

const EXTENSION_ROOT = path.join(__dirname, '..');

const packArb = fc.option(fc.constantFrom('full-forge', 'mono-router', 'other-pack'), { nil: undefined });
const platformArb = fc.constantFrom('linux', 'darwin', 'win32');
const rotationArb = fc.option(fc.constant('router'), { nil: undefined });
const overrideArb = fc.option(fc.integer({ min: 1, max: 64 }).map(String), { nil: undefined });
const defaultCeilingArb = fc.option(fc.integer({ min: 1, max: 128 }), { nil: undefined });
const hostRamMBArb = fc.integer({ min: 1, max: 500000 });

test('BL-1348 P1 (invariant 2): the resolved pool is never smaller than 1, for any host RAM, override, pack, platform, rotation or defaultCeiling', () => {
  fc.assert(
    fc.property(packArb, platformArb, rotationArb, overrideArb, defaultCeilingArb, hostRamMBArb, (pack, platform, rotation, override, defaultCeiling, hostRamMB) => {
      const pool = resolveVitestWorkerPool({ pack, platform, rotation, override, defaultCeiling, hostRamMB });
      assert.ok(pool >= 1, `expected pool >= 1 for ${JSON.stringify({ pack, platform, rotation, override, defaultCeiling, hostRamMB })}, got ${pool}`);
    }),
    { numRuns: 300 }
  );
});

test('BL-1348 P2 (invariant 3): with no override, full-forge on darwin always resolves to exactly 1, whatever the RAM, rotation or defaultCeiling', () => {
  // Pre-existing precedence (unchanged by this ticket, per the module's own
  // table): "an explicit positive-integer override replaces the pack rule" -
  // full-forge+darwin's ceiling of 1 is the NO-OVERRIDE default, never a
  // floor that survives an explicit override. Caught live: the first draft
  // of this property asserted 1 unconditionally and failed on its own
  // generated override - the property, not the implementation, was wrong.
  fc.assert(
    fc.property(rotationArb, defaultCeilingArb, hostRamMBArb, (rotation, defaultCeiling, hostRamMB) => {
      const pool = resolveVitestWorkerPool({ pack: 'full-forge', platform: 'darwin', rotation, override: undefined, defaultCeiling, hostRamMB });
      assert.equal(pool, 1, `expected full-forge+darwin with no override to always resolve to 1, got ${pool} for ${JSON.stringify({ rotation, defaultCeiling, hostRamMB })}`);
    }),
    { numRuns: 300 }
  );
});

function extractCallBlock(source, needle) {
  const idx = source.indexOf(needle);
  assert.ok(idx !== -1, `expected to find "${needle}" in the config source`);
  const close = source.indexOf('});', idx);
  assert.ok(close !== -1, 'expected a closing "});" for the call block');
  return source.slice(idx, close + 3);
}

test('BL-1348 invariant 1 (structural): both vitest lanes call resolveVitestWorkerPool with the SAME input shape, including the new defaultCeiling', () => {
  const unitSource = fs.readFileSync(path.join(EXTENSION_ROOT, 'vitest.config.mjs'), 'utf8');
  const propsSource = fs.readFileSync(path.join(EXTENSION_ROOT, 'vitest.properties.config.mjs'), 'utf8');

  const unitBlock = extractCallBlock(unitSource, 'const WORKER_POOL_SIZE = resolveVitestWorkerPool({');
  const propsBlock = extractCallBlock(propsSource, 'const WORKER_POOL_SIZE = resolveVitestWorkerPool({');

  for (const key of ['pack:', 'rotation:', 'platform:', 'override:', 'hostRamMB:', 'defaultCeiling:']) {
    assert.ok(unitBlock.includes(key), `expected vitest.config.mjs's call to pass "${key}"`);
    assert.ok(propsBlock.includes(key), `expected vitest.properties.config.mjs's call to pass "${key}"`);
  }
  assert.ok(unitBlock.includes('os.cpus().length'), 'expected vitest.config.mjs to pass the real host core count as defaultCeiling');
  assert.ok(propsBlock.includes('os.cpus().length'), 'expected vitest.properties.config.mjs to pass the real host core count as defaultCeiling');
});
