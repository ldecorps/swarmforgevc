'use strict';

// BL-2072 declared invariant (coder-authored per BL-654 / coder.prompt):
// "Every startup step, getUpdates wait and batch handling that runs
// longer than the threshold leaves exactly one timing line naming that
// phase and its duration; nothing else in the bot's behaviour changes."
//
// Drives the REAL timePhase helper (telegramFrontDeskBotCore.ts) - the
// ONE mechanism all three call sites (runStartupTopicChecks's wrapper in
// main(), and pollAndForward's two phases) share; the acceptance feature
// (BL-2072's own .feature) already proves each of the three real call
// sites is actually wired to it, so this property test is the shared
// helper's own proof, never a second copy of that wiring.
//
// GENERATOR REACH: delayMs is drawn from TWO explicit sub-ranges
// (fc.oneof of [0, threshold) and [threshold, threshold*2]) rather than
// one uniform range spanning the threshold - this is the ticket's own
// boundary (BL-1062/BL-2083's "constructed, not sampled" rule: a single
// uniform draw over an asymmetric range around the threshold could
// statistically starve the rarer side; two explicit sub-ranges drawn with
// equal weight cannot).

const assert = require('node:assert/strict');
const path = require('node:path');
const fc = require('fast-check');

const { timePhase, FRONT_DESK_SLOW_PHASE_THRESHOLD_MS } = require(
  path.join(__dirname, '..', 'out', 'tools', 'telegramFrontDeskBotCore')
);

function makeFakeClock() {
  let current = 0;
  return {
    now: () => current,
    advanceMs: (ms) => {
      current += ms;
    },
  };
}

const belowThreshold = fc.integer({ min: 0, max: FRONT_DESK_SLOW_PHASE_THRESHOLD_MS - 1 });
const atOrAboveThreshold = fc.integer({ min: FRONT_DESK_SLOW_PHASE_THRESHOLD_MS, max: FRONT_DESK_SLOW_PHASE_THRESHOLD_MS * 2 });
const delayArb = fc.oneof(belowThreshold, atOrAboveThreshold);

test('property (BL-2072 invariant): a phase at or over the threshold leaves exactly one timing line naming it; under the threshold leaves none; the phase result is always preserved', async () => {
  let reachedBelow = 0;
  let reachedAtOrAbove = 0;

  await fc.assert(
    fc.asyncProperty(delayArb, fc.string({ minLength: 1, maxLength: 20 }), async (delayMs, resultValue) => {
      if (delayMs < FRONT_DESK_SLOW_PHASE_THRESHOLD_MS) {
        reachedBelow += 1;
      } else {
        reachedAtOrAbove += 1;
      }

      const clock = makeFakeClock();
      const lines = [];
      const phaseName = 'test-phase';

      const result = await timePhase(clock.now, (line) => lines.push(line), phaseName, async () => {
        clock.advanceMs(delayMs);
        return resultValue;
      });

      // Invariant, second half: "nothing else in the bot's behaviour
      // changes" - the wrapped function's own return value rides through
      // timePhase unaffected by the timing it does on the side.
      assert.equal(result, resultValue, `delayMs=${delayMs}: timePhase changed the wrapped function's own return value`);

      if (delayMs < FRONT_DESK_SLOW_PHASE_THRESHOLD_MS) {
        assert.deepEqual(lines, [], `delayMs=${delayMs} (under threshold): expected no timing line, got ${JSON.stringify(lines)}`);
      } else {
        assert.equal(lines.length, 1, `delayMs=${delayMs} (at/over threshold): expected exactly one timing line, got ${JSON.stringify(lines)}`);
        // The line's own fixed prefix: a StringLiteral mutant that empties
        // the prefix (Stryker survivor on timePhase's log line) must fail
        // here, not only on the phase name.
        assert.ok(lines[0].startsWith('front-desk-phase-slow: '), `delayMs=${delayMs}: line does not carry the front-desk-phase-slow prefix: ${lines[0]}`);
        assert.ok(lines[0].includes(phaseName), `delayMs=${delayMs}: line does not name the phase: ${lines[0]}`);
        const match = lines[0].match(/took (\d+)ms/);
        assert.ok(match, `delayMs=${delayMs}: line has no duration: ${lines[0]}`);
        assert.ok(Number(match[1]) >= delayMs, `delayMs=${delayMs}: line's own duration (${match[1]}ms) is less than the delay`);
      }
    }),
    { numRuns: 40 }
  );

  assert.ok(reachedBelow >= 5, `generator reach floor: reachedBelow=${reachedBelow}`);
  assert.ok(reachedAtOrAbove >= 5, `generator reach floor: reachedAtOrAbove=${reachedAtOrAbove}`);
});
