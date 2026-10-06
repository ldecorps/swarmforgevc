const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  updateThrottleEpisode,
  heldCapForEpisode,
} = require('../out/tools/emit-throttle-recommendation');

// BL-1981 (BL-654: coder owns first authorship of each declared
// invariant's property test): the ticket declares three invariants. Each
// gets its own property below, driving the REAL compiled
// updateThrottleEpisode/heldCapForEpisode state machine (pure, no fs) over
// randomized tick sequences - never a restatement of the fold/hold logic
// in the test itself. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs) - excluded from unit/coverage/mutation.

const CONFIGURED_CAP = 6;

function fakeRec(rawCap) {
  return {
    recommendedCap: rawCap,
    severity: rawCap === null ? null : rawCap === 0 ? 'severe' : 'degraded',
    reworkRate: null,
    baselineRate: null,
    standingRed: null,
    updated_at: '2026-10-05T00:00:00Z',
    heldCap: null,
    episode: null,
  };
}

// A tick either names a live elevated cap (0 or 1, Article 3.5's own two
// named caps) or clears (null).
const tickCapArb = fc.oneof(fc.constant(0), fc.constant(1), fc.constant(null));

// A long random walk of ticks, each optionally followed by a human answer
// being recorded on whatever episode is open at that point (release, or a
// keep at an arbitrary bounded value) - exactly the two inputs the real
// CLI accepts.
const answerArb = fc.option(
  fc.oneof(
    fc.constant({ kind: 'release' }),
    fc.integer({ min: 0, max: 10 }).map((value) => ({ kind: 'keep', value }))
  ),
  { nil: null }
);

const tickArb = fc.record({ rawCap: tickCapArb, answer: answerArb });
const tickSequenceArb = fc.array(tickArb, { minLength: 1, maxLength: 40 });

function applyTick(episode, tick, nowMsRef) {
  nowMsRef.ms += 1000;
  const nowIso = new Date(nowMsRef.ms).toISOString();
  let next = updateThrottleEpisode(episode, tick.rawCap, CONFIGURED_CAP, nowIso, fakeRec(tick.rawCap));
  if (next && tick.answer && next.answer === null) {
    next = { ...next, answer: { ...tick.answer, by: 'human', at: nowIso } };
  }
  return next;
}

// The "effective" combination exactly as backlog_depth_lib.bb's own
// min-recommended-cap folds rawCap and heldCap - never raising above
// either, re-derived here only as the never-raise comparator the
// invariant itself is about, not as a restatement of updateThrottleEpisode.
function minRecommendedCap(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

// ── invariant 1: "The effective cap is never above min(configured, the ───
//    run's own fresh recommendation); a recorded answer only ends or sets
//    the hold, it never lifts a live signal's cap." ───────────────────────

test('property: the effective cap never exceeds the configured cap or a currently-live recommendation, whatever answer is on record', () => {
  fc.assert(
    fc.property(tickSequenceArb, (ticks) => {
      let episode = null;
      const nowMsRef = { ms: Date.parse('2026-10-05T00:00:00Z') };
      for (const tick of ticks) {
        episode = applyTick(episode, tick, nowMsRef);
        const heldCap = heldCapForEpisode(episode);
        const effective = minRecommendedCap(minRecommendedCap(CONFIGURED_CAP, tick.rawCap), heldCap);
        if (tick.rawCap !== null) {
          assert.ok(effective <= tick.rawCap, `effective (${effective}) must never exceed a currently-live recommendation (${tick.rawCap})`);
        }
        assert.ok(effective <= CONFIGURED_CAP, `effective (${effective}) must never exceed the configured cap (${CONFIGURED_CAP})`);
      }
    }),
    { numRuns: 200 }
  );
});

// ── invariant 2: "Within one episode the effective cap never rises above ──
//    the lowest cap that episode reached until a human answer is recorded
//    for that episode." ────────────────────────────────────────────────────

test('property: an unanswered episode\'s held floor only ever falls or stays, never rises, across any sequence of live caps', () => {
  fc.assert(
    fc.property(fc.array(fc.oneof(fc.constant(0), fc.constant(1)), { minLength: 1, maxLength: 30 }), (liveCaps) => {
      let episode = null;
      let priorLowest = Infinity;
      const nowMsRef = { ms: Date.parse('2026-10-05T00:00:00Z') };
      for (const rawCap of liveCaps) {
        episode = applyTick(episode, { rawCap, answer: null }, nowMsRef);
        assert.ok(episode, 'a live elevated cap must keep (or open) an episode');
        assert.equal(episode.answer, null, 'this property only drives unanswered episodes');
        assert.ok(episode.lowestCapReached <= priorLowest, `lowestCapReached (${episode.lowestCapReached}) must never rise above its own prior value (${priorLowest})`);
        assert.equal(heldCapForEpisode(episode), episode.lowestCapReached, 'an unanswered episode holds at exactly its lowest cap reached');
        priorLowest = episode.lowestCapReached;
      }
      // Clearing afterward (no answer) must still hold at the same floor,
      // never rising back toward the configured cap on its own.
      episode = applyTick(episode, { rawCap: null, answer: null }, nowMsRef);
      assert.equal(heldCapForEpisode(episode), priorLowest, 'clearing an unanswered episode must not raise the held floor');
    }),
    { numRuns: 200 }
  );
});

// ── invariant 3: "An answer recorded for one episode never applies to ────
//    any later episode." ───────────────────────────────────────────────────

test('property: a released-and-closed episode leaves no trace in the next episode it opens, whatever cap the next one opens at', () => {
  fc.assert(
    fc.property(fc.oneof(fc.constant(0), fc.constant(1)), (nextEpisodeCap) => {
      const nowMsRef = { ms: Date.parse('2026-10-05T00:00:00Z') };
      // Episode A: opens, is released, then closes once its own raw
      // signal clears - the only path that ever truly closes an episode
      // (BL-1981's own closing rule; a keep never auto-closes).
      let episodeA = applyTick(null, { rawCap: 1, answer: { kind: 'release' } }, nowMsRef);
      assert.equal(episodeA.answer.kind, 'release');
      episodeA = applyTick(episodeA, { rawCap: null, answer: null }, nowMsRef); // clears -> closes
      assert.equal(episodeA, null, 'setup: a released episode must close once its raw signal clears');

      // Episode B: a brand-new crossing, with NO answer at all this time.
      const episodeB = applyTick(episodeA, { rawCap: nextEpisodeCap, answer: null }, nowMsRef);
      assert.ok(episodeB, 'a fresh crossing after closure must open a new episode');
      assert.equal(episodeB.answer, null, "episode A's release must never carry into episode B");
      assert.equal(episodeB.lowestCapReached, nextEpisodeCap, "episode B's own floor must be its own fresh value, not inherited");
    }),
    { numRuns: 50 }
  );
});

// ── BL-2034 invariant: "Any tick with a live raw recommendation leaves ────
//    clearedAtIso null - a re-tripped episode is live, not awaiting
//    release." ─────────────────────────────────────────────────────────────

test('property: any tick with a live raw recommendation leaves clearedAtIso null, whatever the episode\'s prior history', () => {
  fc.assert(
    fc.property(tickSequenceArb, (ticks) => {
      let episode = null;
      const nowMsRef = { ms: Date.parse('2026-10-05T00:00:00Z') };
      for (const tick of ticks) {
        episode = applyTick(episode, tick, nowMsRef);
        if (tick.rawCap !== null) {
          assert.ok(episode, 'a live tick must keep (or open) an episode');
          assert.equal(episode.clearedAtIso, null, `a live raw recommendation (${tick.rawCap}) must leave clearedAtIso null - the episode is live, not awaiting release`);
        }
      }
    }),
    { numRuns: 200 }
  );
});
