const assert = require('node:assert/strict');
const fc = require('fast-check');
const { runReviewChain } = require('../out/benchmark/pipelineReviewOracle');

// BL-387/BL-479: runReviewChain (extension/src/benchmark/pipelineReviewOracle.ts)
// is the pure orchestration this ticket's bounce fix sits directly upstream
// of - the ordered dispatch that decides, for any sequence of per-stage
// verdicts, how many rounds of rework happened and whether the diff
// survived. benchmarkPipelineReviewOracle.test.js pins this with five
// hand-picked verdict sequences; the counting/stop-on-REJECT contract holds
// for every possible sequence, not just those five, which is exactly the
// "ordering/counting invariant across a broad input range" shape
// architect.prompt's Property Testing section names. Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs); excluded from
// the normal unit/coverage/mutation run.
const verdictArb = fc.constantFrom('ACCEPT', 'REVISED', 'REJECT');

// Index of the first REJECT in a verdict sequence, or -1 if none - the
// point at which runReviewChain stops the chain by construction.
function firstRejectIndex(verdicts) {
  return verdicts.indexOf('REJECT');
}

async function runWithVerdicts(verdicts) {
  const stages = verdicts.map((_, i) => `stage-${i}`);
  const invoked = [];
  const result = await runReviewChain(stages, async (stage) => {
    const verdict = verdicts[invoked.length];
    invoked.push(stage);
    return verdict;
  });
  return { result, invoked, stages };
}

test('property: bounces equals the count of REVISED verdicts strictly before the first REJECT (or across the whole sequence when there is none)', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(verdictArb, { maxLength: 20 }), async (verdicts) => {
      const { result } = await runWithVerdicts(verdicts);
      const stopAt = firstRejectIndex(verdicts);
      const counted = stopAt === -1 ? verdicts : verdicts.slice(0, stopAt);
      const expectedBounces = counted.filter((v) => v === 'REVISED').length;
      assert.equal(result.bounces, expectedBounces, `verdicts=${JSON.stringify(verdicts)}`);
    })
  );
});

test('property: survived is true iff the sequence contains no REJECT', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(verdictArb, { maxLength: 20 }), async (verdicts) => {
      const { result } = await runWithVerdicts(verdicts);
      assert.equal(result.survived, firstRejectIndex(verdicts) === -1, `verdicts=${JSON.stringify(verdicts)}`);
    })
  );
});

test('property: the chain never invokes a stage after the first REJECT - it stops immediately', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(verdictArb, { minLength: 1, maxLength: 20 }), async (verdicts) => {
      const { invoked, stages } = await runWithVerdicts(verdicts);
      const stopAt = firstRejectIndex(verdicts);
      const expectedInvoked = stopAt === -1 ? stages : stages.slice(0, stopAt + 1);
      assert.deepEqual(invoked, expectedInvoked, `verdicts=${JSON.stringify(verdicts)}`);
    })
  );
});
