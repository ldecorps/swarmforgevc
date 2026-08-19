const assert = require('node:assert/strict');
const fc = require('fast-check');
const { resolveWorkerPoolSize, resolveVitestForkCeiling, resolveVitestWorkerPool, MAX_WORKERS } = require('../out/tools/vitest-worker-memory-budget');

// BL-935 (coder.prompt's Invariants section - first authorship rests with
// the coder): coder-authored property tests for two of this ticket's three
// declared invariants. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs); excluded from unit/coverage/mutation.
//
// Invariant 3 ("both vitest lanes resolve their pool through the same code
// path") is NOT encoded here: it quantifies over WHICH function each of the
// two config files' own source calls (a wiring/process claim), not over
// resolveVitestForkCeiling's mathematical behavior across generated inputs
// - a property test over the pure function alone cannot distinguish "both
// configs call this same function" from "one config was miswired to call a
// different, coincidentally-identical function". That is exactly what
// required_wiring + the acceptance feature's own scenario 02 exist to
// catch: both real config files are spawned as real subprocesses with
// stubbed env and their reported maxForks compared
// (specs/pipeline/steps/bl935VitestForkPoolSteps.js), and the wiring itself
// is visible by inspection - since the cleaner pass both vitest.config.mjs
// and vitest.properties.config.mjs import and call the single
// resolveVitestWorkerPool composition from this same module, which is what
// makes invariant 3 true by construction rather than by parallel
// maintenance.
//
// Non-vacuity, checked by hand (re-verified after the architect's D1
// bounce disproved this file's ORIGINAL P1 claim - the first landed P1
// compared resolveWorkerPoolSize(ram, ceiling) against the raw-RAM bound,
// a mathematical identity of resolveWorkerPoolSize's own pre-existing
// `Math.max(1, Math.min(...))` composition that NO finite return value of
// resolveVitestForkCeiling could ever violate; it was structurally
// vacuous and has been replaced):
// - forcing resolveVitestForkCeiling to `return Infinity` fails the
//   "never exceeds the default" property below on its first no-override
//   case, AND the "full-forge on macOS resolves to exactly 1" anchor;
// - inverting the pack rule (full-forge/darwin -> defaultCeiling,
//   everything else -> 1) fails the "full-forge is never given MORE forks
//   than any other combination" relative property;
// - forcing resolveWorkerPoolSize's own floor to `Math.min` instead of
//   `Math.max(1, Math.min(...))` fails the "never below 1" property on
//   its first small-hostRamMB case.
// Restoring the real implementations passes all again.

const packArb = fc.constantFrom('full-forge', 'mono-router', undefined, 'other-pack');
const platformArb = fc.constantFrom('darwin', 'linux', 'win32');
// Overrides deliberately include the malformed/absent shapes invariant 2
// names explicitly (absent, malformed text, zero, negative), plus valid
// positive integers of varying size relative to the memory-derived count.
const overrideArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.constant('not-a-number'),
  fc.integer({ min: -10, max: 0 }).map(String),
  fc.integer({ min: 1, max: 500 }).map(String)
);
const hostRamMbArb = fc.integer({ min: 0, max: 65536 });

// Invariant 1's "the new ceiling can only LOWER the fork count, never
// raise it", encoded over what resolveVitestForkCeiling itself CONTROLS
// (the architect's D1 bounce showed the memory-bound comparison is a
// property of resolveWorkerPoolSize's own pre-existing composition, which
// no return value of the new function can violate - vacuous). Without an
// explicit override there are only two legitimate outcomes - the default
// ceiling, or the pack rule's LOWER 1 - so "never raise" over the pack/
// platform space means: never above the default. An unconstrained
// implementation (Infinity) fails this on its first case.
test('property: without an explicit override, the ceiling never exceeds the default, for every pack/platform', () => {
  fc.assert(
    fc.property(packArb, platformArb, (pack, platform) => {
      const ceiling = resolveVitestForkCeiling({ pack, platform, override: undefined });
      assert.ok(
        ceiling <= MAX_WORKERS,
        `ceiling (${ceiling}) exceeded the default (${MAX_WORKERS}) for pack=${pack} platform=${platform} with no override`
      );
    }),
    { numRuns: 200 }
  );
});

// The relative half of invariant 1's "for every combination of pack,
// platform and override": full-forge on macOS - the one combination the
// pack rule constrains - is never given MORE forks than any other
// combination under the same override and host RAM. Catches a
// direction-inverted pack rule (constraining everything EXCEPT the
// intended combination), which the absolute anchor below cannot see when
// the anchor's own combination happens to come out right.
test('property: full-forge on macOS is never given more forks than any other combination, same override and RAM', () => {
  fc.assert(
    fc.property(hostRamMbArb, packArb, platformArb, overrideArb, (hostRamMB, otherPack, otherPlatform, override) => {
      const fullForgeCeiling = resolveVitestForkCeiling({ pack: 'full-forge', platform: 'darwin', override });
      const otherCeiling = resolveVitestForkCeiling({ pack: otherPack, platform: otherPlatform, override });
      const fullForgeForks = resolveWorkerPoolSize(hostRamMB, fullForgeCeiling);
      const otherForks = resolveWorkerPoolSize(hostRamMB, otherCeiling);
      assert.ok(
        fullForgeForks <= otherForks,
        `full-forge/darwin resolved ${fullForgeForks} forks > ${otherForks} under pack=${otherPack} platform=${otherPlatform} override=${override} hostRamMB=${hostRamMB}`
      );
    }),
    { numRuns: 500 }
  );
});

test('property: the resolved fork count is never below 1, for any combination of inputs', () => {
  fc.assert(
    fc.property(hostRamMbArb, packArb, platformArb, overrideArb, (hostRamMB, pack, platform, override) => {
      const ceiling = resolveVitestForkCeiling({ pack, platform, override });
      assert.ok(ceiling >= 1, `ceiling itself was below 1: ${ceiling}`);
      const resolved = resolveWorkerPoolSize(hostRamMB, ceiling);
      assert.ok(resolved >= 1, `resolved fork count was below 1: ${resolved}`);
    }),
    { numRuns: 500 }
  );
});

// A sharper case within invariant 1: full-forge+macOS with no override must
// land EXACTLY at min(1, memory-derived) = 1 (never merely "not above" -
// the pack rule's own claimed value), across every possible memory budget.
test('property: full-forge on macOS with no override resolves to exactly 1, at every possible host RAM size', () => {
  fc.assert(
    fc.property(hostRamMbArb, (hostRamMB) => {
      const ceiling = resolveVitestForkCeiling({ pack: 'full-forge', platform: 'darwin', override: undefined });
      assert.equal(resolveWorkerPoolSize(hostRamMB, ceiling), 1);
    }),
    { numRuns: 200 }
  );
});

// A sharper case for invariant 2's "malformed override" clause: any
// non-positive-integer override string is ALWAYS ignored (never floored,
// never coerced) - the ceiling falls through to the pack rule exactly as
// if no override were set at all.
test('property: a non-positive-integer override is always ignored, resolving identically to no override at all', () => {
  const malformedArb = fc.oneof(
    fc.constant(''),
    fc.constant('not-a-number'),
    fc.integer({ min: -1000, max: 0 }).map(String),
    fc.double({ noInteger: true, min: -1000, max: 1000, noNaN: true }).map(String)
  );
  fc.assert(
    fc.property(packArb, platformArb, malformedArb, (pack, platform, malformed) => {
      const withMalformed = resolveVitestForkCeiling({ pack, platform, override: malformed });
      const withoutOverride = resolveVitestForkCeiling({ pack, platform, override: undefined });
      assert.equal(withMalformed, withoutOverride, `override=${JSON.stringify(malformed)} was not ignored`);
    }),
    { numRuns: 300 }
  );
});

// ── architect property-coverage pass (BL-935 cleaner parcel) ────────────────
// The cleaner collapsed both lanes onto ONE composition, resolveVitestWorkerPool,
// and both vitest.config.mjs and vitest.properties.config.mjs now call only
// that. Every property above tests the resolveVitestForkCeiling /
// resolveWorkerPoolSize PAIR composed by hand in the test itself - none of them
// calls the route the configs actually use, so a miswire inside
// resolveVitestWorkerPool (swapped arguments, a dropped ceiling, a stray
// default) would leave every property green. The decision-table unit test in
// vitestWorkerMemoryBudget.test.js is currently the only gate on that route;
// these two properties extend it to the whole generated input space.
//
// Non-vacuity, verified by breaking resolveVitestWorkerPool and restoring it:
// - dropping the ceiling (`return resolveWorkerPoolSize(hostRamMB)`) fails the
//   equivalence property on its first full-forge/darwin case;
// - passing the ceiling as the perWorkerHeapMB argument
//   (`resolveWorkerPoolSize(hostRamMB, undefined, ceiling)`) fails both.

test('property: resolveVitestWorkerPool is exactly the ceiling composed with the memory budget, over the whole input space', () => {
  fc.assert(
    fc.property(hostRamMbArb, packArb, platformArb, overrideArb, (hostRamMB, pack, platform, override) => {
      assert.equal(
        resolveVitestWorkerPool({ pack, platform, override, hostRamMB }),
        resolveWorkerPoolSize(hostRamMB, resolveVitestForkCeiling({ pack, platform, override })),
        `composed route diverged for pack=${pack} platform=${platform} override=${override} hostRamMB=${hostRamMB}`
      );
    }),
    { numRuns: 500 }
  );
});

// Invariant 1 ("the new ceiling can only LOWER the fork count, never raise it")
// asserted through the REAL route rather than the hand-composed pair: whatever
// the pack/platform rule decides, the result never exceeds what the memory
// budget alone would have allowed.
test('property: resolveVitestWorkerPool never exceeds the memory-only budget, for every pack/platform', () => {
  fc.assert(
    fc.property(hostRamMbArb, packArb, platformArb, (hostRamMB, pack, platform) => {
      const memoryOnly = resolveWorkerPoolSize(hostRamMB);
      const composed = resolveVitestWorkerPool({ pack, platform, override: undefined, hostRamMB });
      assert.ok(
        composed <= memoryOnly,
        `composed ${composed} exceeded memory-only ${memoryOnly} for pack=${pack} platform=${platform} hostRamMB=${hostRamMB}`
      );
      assert.ok(composed >= 1, `composed fork count below 1: ${composed}`);
    }),
    { numRuns: 500 }
  );
});
