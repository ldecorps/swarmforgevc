'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  aggregateRotationDynamics,
  queryRotationDynamics,
  DEFAULT_THRASH_WINDOW_MS,
} = require('../out/metrics/rotationDynamics');

const ROLES = ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

test('property (invariant 2): aggregation depends only on in-memory events', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          at: fc.integer({ min: Date.parse('2026-08-01T00:00:00Z'), max: Date.parse('2026-08-28T00:00:00Z') }).map(
            (ms) => new Date(ms).toISOString()
          ),
          from: fc.constantFrom(...ROLES),
          to: fc.constantFrom(...ROLES),
          reason: fc.constantFrom('chase', 'handoff-forward', 'rotate-home', 'rotate'),
        }),
        { minLength: 0, maxLength: 8 }
      ),
      (events) => {
        const startMs = Date.parse('2026-08-27T00:00:00.000Z');
        const endMs = Date.parse('2026-08-28T00:00:00.000Z');
        const a = aggregateRotationDynamics(events, {
          startMs,
          endMs,
          homeRole: 'coder',
          thrashWindowMs: DEFAULT_THRASH_WINDOW_MS,
        });
        const b = aggregateRotationDynamics([...events], {
          startMs,
          endMs,
          homeRole: 'coder',
          thrashWindowMs: DEFAULT_THRASH_WINDOW_MS,
        });
        assert.deepEqual(a, b);
      }
    ),
    { numRuns: 40 }
  );
});

test('property (invariant 3): non-mono-router query never throws and returns NA', () => {
  fc.assert(
    fc.property(fc.boolean(), (mono) => {
      const result = queryRotationDynamics([], { startMs: 0, endMs: 1, homeRole: 'coder' }, mono);
      if (!mono) {
        assert.equal(result.applicable, false);
        assert.equal(result.aggregate, null);
      } else {
        assert.equal(result.applicable, true);
        assert.ok(result.aggregate);
      }
    }),
    { numRuns: 20 }
  );
});

test('property (invariant 1): thrash plus ordinary equals in-window rotation count', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          at: fc.integer({ min: Date.parse('2026-08-27T10:00:00Z'), max: Date.parse('2026-08-27T12:00:00Z') }).map(
            (ms) => new Date(ms).toISOString()
          ),
          from: fc.constantFrom('coder', 'cleaner'),
          to: fc.constantFrom('coder', 'cleaner'),
          reason: fc.constant('chase'),
        }),
        { minLength: 1, maxLength: 6 }
      ),
      (events) => {
        const agg = aggregateRotationDynamics(events, {
          startMs: Date.parse('2026-08-27T09:00:00.000Z'),
          endMs: Date.parse('2026-08-27T13:00:00.000Z'),
          homeRole: 'coder',
          thrashWindowMs: 30_000,
        });
        assert.equal(agg.thrashRotations + agg.ordinaryRotations, events.length);
      }
    ),
    { numRuns: 40 }
  );
});
