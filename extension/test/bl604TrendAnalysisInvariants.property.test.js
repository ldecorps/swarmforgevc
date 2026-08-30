'use strict';

// BL-604's two declared invariants, coder-authored (BL-654), property lane
// only.
//
// Invariant 1 - "Every bullet's stated direction and magnitude equal
// computeTrend's own direction and delta for that series - the narrative
// renders the computed trend and never derives a judgement of its own."
//
//   The reader sees a bullet and a chart side by side. If the bullet's slope
//   is its own, the two can disagree and nothing tells the reader which lied.
//   So the property compares every rendered bullet - the parsed TEXT, not the
//   struct that produced it - against computeTrend called directly on the same
//   points. Reading the text matters: a builder could carry a correct
//   `direction` field and print the opposite word, and only the printed word
//   reaches the briefing.
//
// Invariant 2 - "A series appears in the section if and only if computeTrend
// returns a direction other than 'unknown' for it - absence of data is never
// rendered as a finding."
//
//   IF AND ONLY IF, so both directions are checked on every draw: no
//   un-trendable series gains a bullet, and no trendable one loses one (except
//   to the declared bound, which is checked separately so the two reasons for
//   absence never blur).
//
//   The ticket's own e2e procedure names the generator reach this needs, and
//   it is right: "a generator that only ever produces trendable series makes
//   invariant 2 vacuous". So series LENGTH is drawn from {0, 1, many} with a
//   floor on each, and both signs of delta carry their own floor too.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { assertReachFloor } = require('./helpers/reachFloors');
const { computeTrend } = require('../out/metrics/trend');
const {
  buildTrendAnalysis,
  loadTrendAnalysis,
  renderTrendAnalysisSection,
  TREND_ANALYSIS_MAX_BULLETS,
} = require('../out/metrics/trendAnalysis');

const LENGTHS = { none: [0, 0], one: [1, 1], many: [2, 8] };
const LENGTH_FLOOR = 12;
const SIGN_FLOOR = 10;

const valueArb = fc.integer({ min: -50, max: 200 });

function pointsOfLength(n) {
  return fc.array(valueArb, { minLength: n, maxLength: n }).map((values) =>
    values.map((value, i) => ({ periodStart: `2026-08-${String(i + 1).padStart(2, '0')}`, value }))
  );
}

// A drawn set of series, each with its length drawn from the named bucket, so
// a single run mixes trendable and un-trendable ones - which is the state the
// real registry is in most mornings.
function seriesSetArb(bucket) {
  const [min, max] = LENGTHS[bucket];
  return fc.array(
    fc.integer({ min, max }).chain((n) => pointsOfLength(n).map((points) => points)),
    { minLength: 1, maxLength: 6 }
  ).map((all) => all.map((points, i) => ({ id: `s${i}`, label: `Series ${i}`, points })));
}

// The rendered section, parsed back the way a reader reads it.
function parseBullets(text) {
  return text
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => {
      const m = /^- (.+): (up|down|flat) ([+-]?[\d.]+) \(([-\d.]+) → ([-\d.]+)\)/.exec(line);
      assert.ok(m, `a rendered bullet does not read as direction + magnitude: ${line}`);
      return { label: m[1], direction: m[2], delta: Number(m[3]), prior: Number(m[4]), current: Number(m[5]) };
    });
}

describe('BL-604 invariant 1: the narrative renders the computed trend', () => {
  it('states computeTrend own direction and delta, as printed', () => {
    const coverage = {};
    for (const bucket of Object.keys(LENGTHS)) {
      fc.assert(
        fc.property(seriesSetArb(bucket), (loaded) => {
          coverage[bucket] = (coverage[bucket] || 0) + 1;
          const bullets = buildTrendAnalysis(loaded, loaded.length);
          const rendered = parseBullets(renderTrendAnalysisSection(bullets));

          assert.equal(rendered.length, bullets.length, 'a bullet was built and not rendered, or vice versa');
          rendered.forEach((printed, i) => {
            const own = computeTrend(loaded.find((s) => s.label === printed.label).points);
            assert.equal(printed.direction, own.direction, `${printed.label}: printed direction disagrees with computeTrend`);
            assert.equal(printed.delta, own.delta, `${printed.label}: printed magnitude disagrees with computeTrend`);
            assert.equal(printed.current, own.currentValue);
            assert.equal(printed.prior, own.priorValue);
            if (own.delta > 0) coverage.up = (coverage.up || 0) + 1;
            if (own.delta < 0) coverage.down = (coverage.down || 0) + 1;
            if (own.delta === 0) coverage.flat = (coverage.flat || 0) + 1;
            void i;
          });
          return true;
        }),
        { numRuns: LENGTH_FLOOR }
      );
    }
    assertReachFloor(coverage, Object.keys(LENGTHS), LENGTH_FLOOR, 'series length bucket');
    assertReachFloor(coverage, ['up', 'down'], SIGN_FLOOR, 'delta sign');
  });
});

describe('BL-604 invariant 2: a bullet exists exactly when the series can be trended', () => {
  it('omits every un-trendable series and keeps every trendable one', () => {
    const coverage = {};
    for (const bucket of Object.keys(LENGTHS)) {
      fc.assert(
        fc.property(seriesSetArb(bucket), (loaded) => {
          coverage[bucket] = (coverage[bucket] || 0) + 1;
          // The bound is lifted here so absence has exactly ONE cause to test.
          const built = new Set(buildTrendAnalysis(loaded, loaded.length).map((b) => b.seriesId));

          for (const s of loaded) {
            const trendable = computeTrend(s.points).direction !== 'unknown';
            if (trendable) {
              coverage.trendable = (coverage.trendable || 0) + 1;
              assert.ok(built.has(s.id), `${s.id} has ${s.points.length} points and lost its bullet`);
            } else {
              coverage.untrendable = (coverage.untrendable || 0) + 1;
              assert.ok(
                !built.has(s.id),
                `${s.id} has ${s.points.length} point(s) and was reported anyway - absence of data rendered as a finding`
              );
            }
          }
          return true;
        }),
        { numRuns: LENGTH_FLOOR }
      );
    }
    assertReachFloor(coverage, Object.keys(LENGTHS), LENGTH_FLOOR, 'series length bucket');
    // Both sides of the "if and only if" must actually have been reached.
    assertReachFloor(coverage, ['trendable', 'untrendable'], LENGTH_FLOOR, 'trendability');
  });

  it('never rescues a series by way of a throwing loader', () => {
    const coverage = {};
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 5 }), (throwers, healthy) => {
        coverage.draw = (coverage.draw || 0) + 1;
        const sources = [
          ...Array.from({ length: throwers }, (_, i) => ({
            id: `boom${i}`,
            label: `Boom ${i}`,
            producer: 'x',
            loadPoints: () => {
              throw new Error('ledger is malformed');
            },
          })),
          ...Array.from({ length: healthy }, (_, i) => ({
            id: `fine${i}`,
            label: `Fine ${i}`,
            producer: 'x',
            loadPoints: () => [
              { periodStart: '2026-08-01', value: 4 },
              { periodStart: '2026-08-02', value: 8 },
            ],
          })),
        ];

        const bullets = loadTrendAnalysis({ targetPath: '/nowhere', nowMs: 0 }, sources, sources.length || 1);

        assert.equal(bullets.length, healthy, 'a throwing loader cost more than its own bullet');
        assert.ok(
          bullets.every((b) => b.seriesId.startsWith('fine')),
          'a series whose loader threw was reported anyway'
        );
        if (throwers > 0) coverage.threw = (coverage.threw || 0) + 1;
        return true;
      }),
      { numRuns: 60 }
    );
    assertReachFloor(coverage, ['threw'], 20, 'draws containing a throwing loader');
  });

  it('keeps the bound the only other reason a bullet is absent', () => {
    const loaded = Array.from({ length: TREND_ANALYSIS_MAX_BULLETS + 3 }, (_, i) => ({
      id: `s${i}`,
      label: `S${i}`,
      points: [
        { periodStart: '2026-08-01', value: 10 },
        { periodStart: '2026-08-02', value: 10 + i + 1 },
      ],
    }));

    assert.equal(buildTrendAnalysis(loaded).length, TREND_ANALYSIS_MAX_BULLETS);
    assert.equal(buildTrendAnalysis(loaded, loaded.length).length, loaded.length);
  });
});
