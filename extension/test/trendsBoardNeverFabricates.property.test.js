const assert = require('node:assert/strict');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');

const { buildTrendsBoardState } = require('../out/bridge/bridgeState');
const { TRENDS_BOARD_SERIES } = require('../out/metrics/trendsBoardRegistry');

// BL-603 invariant 1: "The board never fabricates a point: a series with
// nothing to plot renders as absent data, and no path invents a zero, a flat
// line, or an interpolated value to fill the gap."
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs);
// excluded from the normal unit/coverage/mutation run.
//
// Generator reach: the states this invariant quantifies over are (a) a
// series that loads nothing and (b) a series that loads something. Drawing
// point arrays from fc.array with minLength 0 would make the empty case
// vanishingly rare once the array length distribution is uniform over
// 0..10, so the arbitrary below draws the EMPTY case as an explicit
// oneof branch with equal weight - an asserted reachability floor, checked
// by the counter assertions at the end of each property rather than hoped
// for.

const FIXTURE_PREFIX = 'bl603-prop-';

const pointArb = fc.record({
  periodStart: fc
    .integer({ min: Date.parse('2020-01-01T00:00:00.000Z'), max: Date.parse('2030-01-01T00:00:00.000Z') })
    .map((ms) => new Date(ms).toISOString()),
  value: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
});

// Equal-weight empty / non-empty, so both halves of the invariant are
// exercised on every run rather than one dominating.
const pointsArb = fc.oneof(
  fc.constant([]),
  fc.array(pointArb, { minLength: 1, maxLength: 10 })
);

const sourceArb = fc
  .tuple(fc.string({ minLength: 1, maxLength: 12 }), pointsArb)
  .map(([id, points]) => ({
    id,
    label: id,
    producer: id + '.ts',
    loadPoints: () => points,
    expectedPoints: points,
  }));

test('property: a series with no points is reported as absent data and no point is invented for it', () => {
  const dir = mkTmpDir(FIXTURE_PREFIX);
  let sawEmpty = 0;
  let sawPopulated = 0;
  fc.assert(
    fc.property(fc.array(sourceArb, { minLength: 1, maxLength: 6 }), fc.integer({ min: 0 }), (sources, nowMs) => {
      const payload = buildTrendsBoardState(dir, nowMs, sources);
      assert.equal(payload.series.length, sources.length);
      payload.series.forEach((rendered, i) => {
        const expected = sources[i].expectedPoints;
        if (expected.length === 0) {
          sawEmpty++;
          // Absent data: no point at all, and no substituted zero/flat line.
          assert.deepEqual(rendered.trend.series, []);
          assert.equal(rendered.hasData, false);
          assert.equal(rendered.trend.currentValue, null);
          assert.equal(rendered.trend.priorValue, null);
          assert.equal(rendered.trend.delta, null);
          assert.equal(rendered.trend.direction, 'unknown');
        } else {
          sawPopulated++;
          // No interpolation either: the plotted points are EXACTLY the
          // producer's own, same count, same order, same values.
          assert.equal(rendered.hasData, true);
          assert.deepEqual(rendered.trend.series, expected);
        }
      });
    }),
    { numRuns: 200 }
  );
  // Reachability floor, asserted rather than hoped for.
  assert.ok(sawEmpty > 20, `expected the empty-series state to be reached often, saw ${sawEmpty}`);
  assert.ok(sawPopulated > 20, `expected the populated-series state to be reached often, saw ${sawPopulated}`);
});

test('property: a loader that throws is absent data, never a board-wide failure', () => {
  const dir = mkTmpDir(FIXTURE_PREFIX);
  fc.assert(
    fc.property(
      fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
      fc.integer({ min: 0 }),
      (throwFlags, nowMs) => {
        const sources = throwFlags.map((shouldThrow, i) => ({
          id: 'series-' + i,
          label: 'Series ' + i,
          producer: 'p' + i + '.ts',
          loadPoints: () => {
            if (shouldThrow) {
              throw new Error('producer has not landed');
            }
            return [{ periodStart: '2026-08-28T00:00:00.000Z', value: i }];
          },
        }));
        const payload = buildTrendsBoardState(dir, nowMs, sources);
        // Every series still has a place, and a throwing one is absent
        // data - it never removes the board or its healthy neighbours.
        assert.equal(payload.series.length, sources.length);
        payload.series.forEach((rendered, i) => {
          assert.equal(rendered.hasData, !throwFlags[i]);
          if (throwFlags[i]) {
            assert.deepEqual(rendered.trend.series, []);
          }
        });
      }
    ),
    { numRuns: 200 }
  );
});

test('property: the shipped registry never fabricates a point on a target with no telemetry', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: Date.parse('2026-01-01T00:00:00.000Z'), max: Date.parse('2027-01-01T00:00:00.000Z') }),
      (nowMs) => {
        const dir = mkTmpDir(FIXTURE_PREFIX);
        const payload = buildTrendsBoardState(dir, nowMs);
        assert.equal(payload.series.length, TRENDS_BOARD_SERIES.length);
        for (const series of payload.series) {
          assert.deepEqual(series.trend.series, [], `${series.id} invented a point on an empty target`);
          assert.equal(series.hasData, false);
        }
      }
    ),
    { numRuns: 25 }
  );
});
