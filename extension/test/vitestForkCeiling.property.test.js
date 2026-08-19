const assert = require('node:assert/strict');
const fc = require('fast-check');
const { resolveWorkerPoolSize, resolveVitestForkCeiling, MAX_WORKERS } = require('../out/tools/vitest-worker-memory-budget');

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
// is visible by inspection - both vitest.config.mjs and
// vitest.properties.config.mjs import and call the identical
// resolveVitestForkCeiling/resolveWorkerPoolSize pair from this same
// module.
//
// Non-vacuity, checked by hand before landing: forcing
// resolveVitestForkCeiling to always return Infinity (never any ceiling)
// fails P1 on its first generated case where the pack rule would otherwise
// have lowered the count; forcing resolveWorkerPoolSize's own floor to
// `Math.min` instead of `Math.max(1, Math.min(...))` fails P2 on its first
// small-hostRamMB case. Restoring the real implementations passes both
// again.

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

test('property: the pack/platform/override ceiling never RAISES the fork count above what raw RAM allows', () => {
  fc.assert(
    fc.property(hostRamMbArb, packArb, platformArb, overrideArb, (hostRamMB, pack, platform, override) => {
      // The invariant's own "absolute upper bound" is the RAW memory-derived
      // safe count (approval_context: an explicit override "can never raise
      // the count above what RAM allows"), not resolveWorkerPoolSize's own
      // MAX_WORKERS-capped DEFAULT ceiling - an explicit override is allowed
      // to exceed MAX_WORKERS (a human asking for more parallelism than the
      // fallback default on a big-RAM box), just never exceed raw RAM
      // safety. Number.MAX_SAFE_INTEGER as the ceiling arg strips the
      // MAX_WORKERS cap entirely, leaving only the RAM-derived floor/safety
      // math - the true absolute bound this invariant names.
      const rawMemoryCeiling = resolveWorkerPoolSize(hostRamMB, Number.MAX_SAFE_INTEGER);
      const ceiling = resolveVitestForkCeiling({ pack, platform, override });
      const constrained = resolveWorkerPoolSize(hostRamMB, ceiling);
      assert.ok(
        constrained <= rawMemoryCeiling,
        `constrained (${constrained}) exceeded raw RAM safety (${rawMemoryCeiling}) for hostRamMB=${hostRamMB} pack=${pack} platform=${platform} override=${override}`
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
