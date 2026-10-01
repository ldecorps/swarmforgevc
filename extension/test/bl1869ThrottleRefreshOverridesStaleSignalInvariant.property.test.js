'use strict';

// BL-1869 (BL-654: coder owns first authorship of each declared invariant's
// property test): the ticket declares one invariant - "Every effective-cap
// answer the throttle CLI gives is computed from a rework signal refreshed
// in that same call; a signal an earlier run left on disk never lowers the
// cap." This targets the exact TS wiring 51591aab4a landed:
// emit-throttle-recommendation's main() calls refreshReworkSignal (which
// PERSISTS the fresh signal, overwriting whatever a prior run left) BEFORE
// it ever reads the signal to diagnose. Runs ONLY via `npm run
// test:properties` (vitest.properties.config.mjs) - excluded from
// unit/coverage/mutation.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');
const { refreshReworkSignal } = require('../out/tools/rework-observatory');
const { computeThrottleRecommendation } = require('../out/tools/emit-throttle-recommendation');
const { persistReworkSignal } = require('../out/metrics/reworkObservatoryStore');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

function mkTmp() {
  return mkTmpDir('sfvc-bl1869-refresh-prop-');
}

const DAY_MS = 24 * 60 * 60 * 1000;

function git(cwd, args, dateIso) {
  const env = { ...process.env };
  if (dateIso) {
    env.GIT_AUTHOR_DATE = dateIso;
    env.GIT_COMMITTER_DATE = dateIso;
  }
  execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

function isoDaysAgo(nowMs, days) {
  return new Date(nowMs - days * DAY_MS).toISOString();
}

let ticketSeq = 0;
// Closes one ticket for real, on the fixture's own `main` branch -
// loadCompletedTicketRecords (reworkObservatorySource.ts) is what refresh
// actually reads, never persistReworkSignal (that is the STALE side this
// test writes separately, below). No `mutation_cost:` field: a shared
// ticket-class across every bounced record would read as a concentrated,
// attributable cause (reworkDiagnosis.ts's own describeLikelyCause) and
// flip disposition to 'escalate-only', masking the degraded/severe cells
// this property depends on.
function closeTicket(root, nowMs, daysAgo, bounced) {
  ticketSeq += 1;
  const id = `BL-${90000 + ticketSeq}`;
  const dateIso = isoDaysAgo(nowMs, daysAgo);
  fs.mkdirSync(path.join(root, 'backlog', 'done'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'done', `${id}.yaml`), `id: ${id}\n`);
  if (bounced) {
    fs.mkdirSync(path.join(root, 'backlog', 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'backlog', 'evidence', `${id}-qa-bounce.md`), 'bounce\n');
  }
  git(root, ['add', '.'], dateIso);
  git(root, ['commit', '-q', '-m', `close ${id}`], dateIso);
}

// Four LIVE-history categories, each a real git history inside the trailing
// 14d window / 14-28d baseline (reworkObservatory.ts's own WINDOW_DAYS /
// BASELINE_WINDOW_DAYS) - the shape suboptimalityVerdictLineCli.test.js and
// BL-432's own step handlers already use. `noise` closes unrelated tickets
// WAY outside both windows (40-90d back) that must never affect the outcome.
function buildLiveHistory(root, nowMs, category, noise) {
  for (const n of noise) {
    closeTicket(root, nowMs, n.daysAgo, n.bounced);
  }
  if (category === 'no-sample') {
    return; // no completed tickets inside the live window at all
  }
  if (category === 'no-rework') {
    closeTicket(root, nowMs, 20, true); // baseline: 1 of 1 bounced -> rate 1.0
    closeTicket(root, nowMs, 5, false); // live window: 0 of 1 bounced -> rate 0
    return;
  }
  if (category === 'degraded') {
    closeTicket(root, nowMs, 20, true);
    closeTicket(root, nowMs, 21, false);
    closeTicket(root, nowMs, 22, false); // baseline: 1 of 3 -> rate 1/3
    closeTicket(root, nowMs, 5, true); // live window: 1 of 1 -> rate 1.0 (3x baseline)
    return;
  }
  if (category === 'severe') {
    closeTicket(root, nowMs, 20, true);
    closeTicket(root, nowMs, 21, false);
    closeTicket(root, nowMs, 22, false);
    closeTicket(root, nowMs, 23, false);
    closeTicket(root, nowMs, 24, false); // baseline: 1 of 5 -> rate 0.2
    closeTicket(root, nowMs, 5, true); // live window: 1 of 1 -> rate 1.0 (5x baseline)
    return;
  }
  throw new Error(`unknown live category: ${category}`);
}

function expectedForLiveCategory(category) {
  if (category === 'degraded') {
    return { severity: 'degraded', recommendedCap: 1 };
  }
  if (category === 'severe') {
    return { severity: 'severe', recommendedCap: 0 };
  }
  return { severity: null, recommendedCap: null }; // no-sample and no-rework both carry no verdict
}

// Four STALE-signal categories a PRIOR run could have left on disk - written
// directly via persistReworkSignal, exactly the pre-hotfix fixture shape
// (never through refresh, which is what this test proves overrides them).
function writeStaleSignal(root, category) {
  if (category === 'absent') {
    return; // no prior run at all - no file on disk yet
  }
  const shapes = {
    'no-sample': { hasSample: false, sampleCount: 0, reworkRate: null, baselineRate: null, topRole: null, topTicketClass: null },
    degraded: { hasSample: true, sampleCount: 10, reworkRate: 0.3, baselineRate: 0.1, topRole: null, topTicketClass: null },
    severe: { hasSample: true, sampleCount: 10, reworkRate: 0.9, baselineRate: 0.1, topRole: null, topTicketClass: null },
  };
  persistReworkSignal(root, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:00:00Z',
    signal: shapes[category],
  });
}

const LIVE_CATEGORIES = ['no-sample', 'no-rework', 'degraded', 'severe'];
const STALE_CATEGORIES = ['absent', 'no-sample', 'degraded', 'severe'];
const ALL_CELLS = LIVE_CATEGORIES.flatMap((l) => STALE_CATEGORIES.map((s) => `${l}:${s}`));
const TOTAL_RUNS = 48;
const CELL_RUNS = runsPerCell(TOTAL_RUNS, ALL_CELLS.length);

// Noise tickets dated 40-90 days back - outside both the live window (<14d)
// and the baseline window (14-28d), so they must never move either rate.
const noiseArb = fc.array(fc.record({ daysAgo: fc.integer({ min: 40, max: 90 }), bounced: fc.boolean() }), { maxLength: 3 });

test('property: whatever an earlier run left on disk, a refreshed diagnosis always matches the LIVE git history, never the stale signal', () => {
  const seen = new Set();
  const counts = {};

  // Constructed, not sampled (BL-1572): every one of the 16 live x stale
  // cells gets its own fc.assert with a floor-sized run budget, so the
  // combination that would prove the invariant false - a stale value
  // leaking through for SOME (live, stale) pair - is reached by
  // construction, never hoped for by a uniform draw over both axes.
  for (const liveCategory of LIVE_CATEGORIES) {
    for (const staleCategory of STALE_CATEGORIES) {
      const combo = `${liveCategory}:${staleCategory}`;
      fc.assert(
        fc.property(noiseArb, (noise) => {
          seen.add(combo);
          counts[combo] = (counts[combo] || 0) + 1;
          const root = mkTmp();
          copySeededRepoInto(root);
          const nowMs = Date.now();
          writeStaleSignal(root, staleCategory);
          buildLiveHistory(root, nowMs, liveCategory, noise);
          refreshReworkSignal(root, nowMs);
          const rec = computeThrottleRecommendation(root, nowMs);
          const expected = expectedForLiveCategory(liveCategory);
          assert.equal(rec.severity, expected.severity, `live=${liveCategory} stale=${staleCategory} noise=${JSON.stringify(noise)}`);
          assert.equal(rec.recommendedCap, expected.recommendedCap, `live=${liveCategory} stale=${staleCategory} noise=${JSON.stringify(noise)}`);
        }),
        { numRuns: CELL_RUNS }
      );
    }
  }

  // Reachability floor (engineering.prompt / BL-1062): every one of the 16
  // live-category x stale-category combinations was actually exercised.
  assert.equal(seen.size, ALL_CELLS.length, `expected all ${ALL_CELLS.length} combinations reached, got ${[...seen].sort().join(',')}`);
  assertReachFloor(counts, ALL_CELLS, CELL_RUNS, 'combination');
});
