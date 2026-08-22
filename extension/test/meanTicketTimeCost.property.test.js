const assert = require('node:assert/strict');
const fc = require('fast-check');
const { countGitSpawns } = require('./helpers/gitSpawnCounter');
const { buildClosedTicketCorpus, closeOneMoreTicket } = require('./helpers/backlogCorpusFixture');
const {
  computeMeanTicketTime,
  MEAN_TICKET_TIME_GIT_SUBPROCESS_BOUND,
} = require('../out/metrics/swarmMetrics');

// BL-1066 invariant 2, as declared on the ticket:
//
//   "The cost of one metrics computation does not grow with the number of
//    closed tickets - closing another ticket adds no further git subprocess
//    to a steady-state tick."
//
// Cost is counted by putting a shim named `git` first on PATH (see
// gitSpawnCounter.js), so it counts PROCESSES, whatever API the production
// code reaches them through. The corpus sizes are drawn from two explicit
// regimes rather than one uniform range: a property that only ever saw small
// corpora would pass just as happily against the per-ticket walk this ticket
// removed, which is why the large regime is a generated ARM and its reach is
// asserted below, not hoped for.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const LARGE_CORPUS_FLOOR = 200;

const smallCorpus = () => fc.integer({ min: 0, max: 20 });
const largeCorpus = () => fc.integer({ min: LARGE_CORPUS_FLOOR, max: 400 });
const corpusSize = () => fc.oneof(smallCorpus(), largeCorpus());
// 0 = every closed ticket flat in backlog/done/; > 0 = spread across that
// many milestone subdirectories, the recursive shape the live backlog has.
const milestoneShape = () => fc.integer({ min: 0, max: 4 });

test('property: one computation stays within its declared git-subprocess bound at any corpus size or shape', () => {
  let casesReachingLargeCorpus = 0;
  const numRuns = 12;

  fc.assert(
    fc.property(corpusSize(), milestoneShape(), (count, milestones) => {
      // Built OUTSIDE the counted region: the bound is on the computation's
      // own git, not on the scaffolding that closed the tickets.
      const repo = buildClosedTicketCorpus(count, { milestones, prefix: 'sfvc-bl1066-cost-' });
      const { result, gitCalls } = countGitSpawns(() => computeMeanTicketTime(repo));

      assert.equal(result.sampleCount, count, 'the corpus was not measured in full');
      assert.ok(
        gitCalls.length <= MEAN_TICKET_TIME_GIT_SUBPROCESS_BOUND,
        `${count} closed tickets cost ${gitCalls.length} git processes, over the declared bound of ${MEAN_TICKET_TIME_GIT_SUBPROCESS_BOUND}`
      );
      if (count >= LARGE_CORPUS_FLOOR) {
        casesReachingLargeCorpus += 1;
      }
    }),
    { numRuns }
  );

  assert.ok(
    casesReachingLargeCorpus >= 2,
    `the generator reached a corpus of ${LARGE_CORPUS_FLOOR}+ closed tickets in only ${casesReachingLargeCorpus} of ${numRuns} cases - too rare to be evidence`
  );
});

test('property: closing one more ticket adds no further git subprocess', () => {
  fc.assert(
    fc.property(corpusSize(), milestoneShape(), (count, milestones) => {
      const repo = buildClosedTicketCorpus(count, { milestones, prefix: 'sfvc-bl1066-cost-' });
      const before = countGitSpawns(() => computeMeanTicketTime(repo));

      closeOneMoreTicket(repo);
      const after = countGitSpawns(() => computeMeanTicketTime(repo));

      assert.equal(after.result.sampleCount, before.result.sampleCount + 1, 'the extra ticket was not counted');
      assert.equal(
        after.gitCalls.length,
        before.gitCalls.length,
        `closing one more ticket moved the cost from ${before.gitCalls.length} to ${after.gitCalls.length} git processes`
      );
    }),
    { numRuns: 8 }
  );
});
