const assert = require('node:assert/strict');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');

const { buildTrendsBoardState } = require('../out/bridge/bridgeState');
const { TRENDS_BOARD_SERIES, registeredSeriesIds } = require('../out/metrics/trendsBoardRegistry');
const { getHolisticUiHtml } = require('../out/bridge/holisticUiHtml');

// BL-603 invariant 2: "Every landed BL-594 series is reachable on the board,
// and registering a new one is the only edit needed to publish it - a series
// that exists and is unreachable is a visible gap, never a silent omission."
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Generator reach: the failure this quantifies over is a registered series
// that does NOT reach the board. The naive generator - draw a registry, draw
// an unrelated id, check the id is present - would almost never produce an
// id that collides with the registry, so the interesting state (a series
// added at an arbitrary POSITION among the shipped nine, including first,
// last, and interleaved) is constructed rather than hoped for: the arbitrary
// below derives the candidate registry FROM the shipped one by inserting
// generated series at a generated index, so every draw is a
// publish-a-new-series candidate by construction.

const FIXTURE_PREFIX = 'bl603-reach-';

function newSeries(id) {
  return {
    id,
    label: 'Label for ' + id,
    producer: id + '.ts',
    loadPoints: () => [{ periodStart: '2026-08-28T00:00:00.000Z', value: 1 }],
  };
}

// Insert n generated series at generated positions in the shipped registry.
const registryArb = fc
  .array(
    fc.tuple(fc.string({ minLength: 1, maxLength: 10 }), fc.nat({ max: TRENDS_BOARD_SERIES.length })),
    { minLength: 1, maxLength: 4 }
  )
  .map((insertions) => {
    const registry = [...TRENDS_BOARD_SERIES];
    const addedIds = [];
    insertions.forEach(([suffix, index], i) => {
      const id = 'generated-' + i + '-' + suffix;
      registry.splice(Math.min(index, registry.length), 0, newSeries(id));
      addedIds.push(id);
    });
    return { registry, addedIds };
  });

test('property: every registered series reaches the board, wherever it is registered', () => {
  const dir = mkTmpDir(FIXTURE_PREFIX);
  let sawFirstPosition = 0;
  let sawLastPosition = 0;
  fc.assert(
    fc.property(registryArb, fc.integer({ min: 0 }), ({ registry, addedIds }, nowMs) => {
      const payload = buildTrendsBoardState(dir, nowMs, registry);
      const onBoard = payload.series.map((s) => s.id);
      // Reachability: registry membership and board membership are the
      // same set, in the same order. A registered series is never
      // silently omitted, and the board never carries one that is not
      // registered.
      assert.deepEqual(onBoard, registry.map((s) => s.id));
      for (const id of addedIds) {
        assert.ok(onBoard.includes(id), `registered series ${id} did not reach the board`);
      }
      for (const id of registeredSeriesIds()) {
        assert.ok(onBoard.includes(id), `shipped series ${id} was displaced by a new registration`);
      }
      if (registry[0].id.startsWith('generated-')) sawFirstPosition++;
      if (registry[registry.length - 1].id.startsWith('generated-')) sawLastPosition++;
    }),
    { numRuns: 200 }
  );
  // Reachability floor: both edge positions must actually be generated.
  assert.ok(sawFirstPosition > 5, `expected registrations at the head, saw ${sawFirstPosition}`);
  assert.ok(sawLastPosition > 5, `expected registrations at the tail, saw ${sawLastPosition}`);
});

test('property: publishing a series needs no edit to the renderer or the payload builder', () => {
  const html = getHolisticUiHtml();
  const dir = mkTmpDir(FIXTURE_PREFIX);
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 20 }), (suffix) => {
      const id = 'unheard-of-' + suffix;
      // The renderer, written before this id existed, names no series at
      // all - so it cannot be the thing that has to change.
      assert.ok(!html.includes(id), 'the shipped renderer must not name a series id');
      const payload = buildTrendsBoardState(dir, 0, [...TRENDS_BOARD_SERIES, newSeries(id)]);
      const found = payload.series.find((s) => s.id === id);
      assert.ok(found, `${id} must be published by registration alone`);
      assert.equal(found.hasData, true);
      assert.equal(found.label, 'Label for ' + id);
      assert.equal(found.producer, id + '.ts');
    }),
    { numRuns: 200 }
  );
});
