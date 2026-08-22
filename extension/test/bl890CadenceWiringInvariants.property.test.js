'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  checkSweepWiredInCadence,
  CADENCE_CONDITIONAL_ANCHOR,
} = require('../../specs/pipeline/steps/dispatchGapSteps');

// BL-890 declared invariants (backlog/active/BL-890-cadence-wiring-check-pinned-to-a-stale-600-character-window.yaml):
// 1. The cadence-wiring check's verdict depends only on WHETHER the sweep
//    is invoked inside the cadence conditional, never on WHERE in that
//    block it appears or how much text surrounds it.
// 2. The check distinguishes its two failure modes: sweep not wired into
//    the conditional, versus the conditional not found at all.
//
// Non-vacuity, checked by hand before landing (both properties below):
//   - Invariant 1: reverting checkSweepWiredInCadence to the pre-fix
//     `cadenceBlock.slice(0, 600)` window (the exact regression BL-890
//     fixes) reproduced the failure this property is built to catch - a
//     block padded past 600 characters before the sweep call was reported
//     sweep-not-wired where the property expects ok:true - and restoring
//     the structural (balanced-paren) scan made it pass again.
//   - Invariant 2: collapsing the two `reason` branches in
//     checkSweepWiredInCadence into a single generic failure (so a missing
//     anchor and a present-but-unwired conditional both reported
//     'sweep-not-wired') reproduced a failure where this property's
//     conditional-not-found assertions failed - and restoring the distinct
//     'conditional-not-found' branch made it pass again.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs);
// excluded from the unit/coverage/mutation run per engineering.prompt's
// property-test separation rule.

const SWEEP = 'dispatch-gap-sweep!';

// Balanced sibling forms mirroring handoffd.bb's real cadence siblings
// (chase-sweep!, unassigned-active-nudge-sweep!, ...), each wrapped in its
// own try/catch with a string literal containing a stray ')' - stresses
// the check's string- and comment-skipping the same way real source does.
const siblingArb = fc.constantFrom(
  '(try (chase-sweep!) (catch Exception e (log! "chase-sweep-error)" (.getMessage e))))',
  '(try (unassigned-active-nudge-sweep!) (catch Exception e (log! "nudge-error)" (.getMessage e))))',
  '(try (open-slot-nudge-sweep!) (catch Exception e (log! "slot-error)" (.getMessage e))))',
  ';; a plain comment line mentioning a ) paren and a " quote for good measure'
);
const paddingArb = fc.array(siblingArb, { minLength: 0, maxLength: 6 });
// Deliberately reaches well past the old 600-char window (0..4000), not
// just around it - an asserted reach, not a hoped-for one; explicit
// `examples` below pin the boundary itself and a far-past-boundary case so
// a random draw landing short of 600 can never make the property vacuous.
const commentSizeArb = fc.integer({ min: 0, max: 4000 });

function buildWiredSource(before, after, commentSize) {
  const comment = commentSize === 0 ? '' : ';; ' + 'x'.repeat(commentSize);
  return [CADENCE_CONDITIONAL_ANCHOR, comment, ...before, `(${SWEEP} (load-roles))`, ...after, ')']
    .filter((line) => line !== '')
    .join('\n');
}

test('property: the cadence-wiring check passes regardless of how much text surrounds the sweep call or where it sits', () => {
  fc.assert(
    fc.property(paddingArb, paddingArb, commentSizeArb, (before, after, commentSize) => {
      const src = buildWiredSource(before, after, commentSize);
      assert.deepEqual(checkSweepWiredInCadence(src, SWEEP, CADENCE_CONDITIONAL_ANCHOR), { ok: true });
    }),
    {
      numRuns: 200,
      examples: [
        // The exact BL-890 regression shape: sweep sitting just past, and
        // then far past, the old 600-character window.
        [[], [], 620],
        [[], [], 4000],
        // Sweep as the very first form in the block (no padding at all).
        [[], [], 0],
        // Sweep as the very last form, several sibling blocks ahead of it.
        [
          [
            '(try (chase-sweep!) (catch Exception e (log! "chase-sweep-error)" (.getMessage e))))',
            '(try (open-slot-nudge-sweep!) (catch Exception e (log! "slot-error)" (.getMessage e))))',
          ],
          [],
          0,
        ],
        // Sibling blocks both before AND after the sweep call.
        [
          ['(try (chase-sweep!) (catch Exception e (log! "chase-sweep-error)" (.getMessage e))))'],
          ['(try (unassigned-active-nudge-sweep!) (catch Exception e (log! "nudge-error)" (.getMessage e))))'],
          1200,
        ],
      ],
    }
  );
});

test('property: the check always distinguishes conditional-not-found from sweep-not-wired, never conflating them', () => {
  fc.assert(
    fc.property(
      paddingArb,
      paddingArb,
      fc.boolean(),
      fc.constantFrom('no-when-form-at-all', 'when-form-with-different-anchor'),
      (siblings, tail, sweepAlsoRunsElsewhere, notFoundShape) => {
        // Case A: the cadence conditional IS locatable, but the sweep is
        // not inside it (optionally it runs from a wholly separate timer -
        // proving whole-file substring search would wrongly pass this).
        const elsewhere = sweepAlsoRunsElsewhere
          ? `\n(when (zero? (mod cycle its-own-separate-timer))\n  (${SWEEP} (load-roles)))\n`
          : '';
        const notWiredSrc =
          [CADENCE_CONDITIONAL_ANCHOR, ...siblings, ...tail, ')'].filter((l) => l !== '').join('\n') + elsewhere;
        assert.deepEqual(checkSweepWiredInCadence(notWiredSrc, SWEEP, CADENCE_CONDITIONAL_ANCHOR), {
          ok: false,
          reason: 'sweep-not-wired',
        });

        // Case B: the cadence conditional itself cannot be located at all.
        const notFoundSrc =
          notFoundShape === 'no-when-form-at-all'
            ? [`(defn some-fn []`, ...siblings, `(${SWEEP} (load-roles)))`].join('\n')
            : [`(when (zero? (mod cycle its-own-separate-timer))`, `  (${SWEEP} (load-roles)))`].join('\n');
        assert.deepEqual(checkSweepWiredInCadence(notFoundSrc, SWEEP, CADENCE_CONDITIONAL_ANCHOR), {
          ok: false,
          reason: 'conditional-not-found',
        });
      }
    ),
    { numRuns: 150 }
  );
});
