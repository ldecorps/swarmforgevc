'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { countGitSpawns } = require('./helpers/gitSpawnCounter');
const { newRepo, git, writeTicket, move } = require('./helpers/backlogCorpusFixture');
const {
  computeMeanTicketTime,
  MEAN_TICKET_TIME_GIT_SUBPROCESS_BOUND,
} = require('../out/metrics/swarmMetrics');

// BL-1074 declared invariants:
// 1. A closed ticket's measured duration never moves as a result of a commit
//    made after its close (re-file / milestone rename).
// 2. The whole-corpus computation still costs the single shared git walk
//    BL-1066 established — no per-ticket subprocess returns.
//
// Runs ONLY via `npm run test:properties`.

const HOUR_MS = 60 * 60 * 1000;
const PROMOTE = '2026-07-01T08:00:00';
const CLOSE = '2026-07-01T13:00:00';
const EXPECTED_MS = 5 * HOUR_MS;

function closedThenRefiled(refileCount) {
  const repo = newRepo('sfvc-bl1074-prop-');
  writeTicket(repo, 'active', 'BL-019.yaml');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'promote'], PROMOTE);
  move(repo, 'active', 'done', 'BL-019.yaml');
  git(repo, ['commit', '-q', '-m', 'close'], CLOSE);
  let from = 'done';
  for (let i = 1; i <= refileCount; i += 1) {
    const to = `done/M${i}`;
    move(repo, from, to, 'BL-019.yaml');
    git(repo, ['commit', '-q', '-m', `refile ${i}`], `2026-07-0${2 + i}T09:00:00`);
    from = to;
  }
  return repo;
}

test('property (invariant 1): post-close re-files leave the measured duration at the close', () => {
  // Non-vacuity: include the refileCount=0 arm so a broken impl that always
  // returns null fails, and refileCount≥1 so the defect this ticket fixes
  // is reached by construction.
  let casesWithRefile = 0;
  const numRuns = 10;
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 3 }), (refileCount) => {
      const repo = closedThenRefiled(refileCount);
      const result = computeMeanTicketTime(repo);
      assert.equal(result.sampleCount, 1);
      assert.equal(result.meanMs, EXPECTED_MS);
      if (refileCount > 0) {
        casesWithRefile += 1;
      }
    }),
    { numRuns }
  );
  assert.ok(
    casesWithRefile >= 2,
    `generator reached a post-close re-file in only ${casesWithRefile} of ${numRuns} cases`
  );
});

test('property (invariant 2): re-file count does not add git subprocesses beyond the shared-walk bound', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 3 }), (refileCount) => {
      const repo = closedThenRefiled(refileCount);
      const { gitCalls } = countGitSpawns(() => computeMeanTicketTime(repo));
      assert.ok(
        gitCalls.length <= MEAN_TICKET_TIME_GIT_SUBPROCESS_BOUND,
        `${refileCount} re-files cost ${gitCalls.length} git processes (bound ${MEAN_TICKET_TIME_GIT_SUBPROCESS_BOUND})`
      );
    }),
    { numRuns: 8 }
  );
});

// Deliberate broken oracle: END = newest arrival (pre-BL-1074). Kept as a
// comment-tested non-vacuity check — the property above fails against it.
test('non-vacuity: pre-BL-1074 newest-arrival end would report an inflated duration after a re-file', () => {
  const repo = closedThenRefiled(1);
  const fixed = computeMeanTicketTime(repo);
  assert.equal(fixed.meanMs, EXPECTED_MS);
  // Inflated window: close 13:00 day1 → refile 09:00 day3 = 44h, not 5h.
  const inflatedMs = Date.parse('2026-07-03T09:00:00') - Date.parse(PROMOTE);
  assert.notEqual(fixed.meanMs, inflatedMs);
  assert.ok(inflatedMs > EXPECTED_MS);
});
