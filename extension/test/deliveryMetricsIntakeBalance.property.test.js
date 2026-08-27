'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  deriveIntakeBalanceEvents,
  computeIntakeBalance,
} = require('../out/metrics/deliveryMetrics');

const DAY_MS = 24 * 60 * 60 * 1000;

function commit(dateIso, changes) {
  return { commit: `c-${dateIso}`, dateIso, changes };
}

test('BL-599 P1: epic tracker paths never contribute filed or closed events', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 9999 }), (n) => {
      const path = `backlog/paused/BL-${n}-epic-swarm-behaviour-trends.yaml`;
      const events = deriveIntakeBalanceEvents([
        commit('2026-01-01T00:00:00Z', [{ status: 'A', path }]),
        commit('2026-01-02T00:00:00Z', [{ status: 'R100', path: `backlog/done/M8/BL-${n}-epic-swarm-behaviour-trends.yaml` }]),
      ]);
      assert.equal(events.filedAtMs.length, 0);
      assert.equal(events.closedAtMs.length, 0);
    }),
    { numRuns: 30 }
  );
});

test('BL-599 P2: daily net equals filed minus closed for every bucket', () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 0, maxLength: 8 }),
      fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 0, maxLength: 8 }),
      (filedCounts, closedCounts) => {
        const base = Date.parse('2026-01-01T00:00:00Z');
        const filedAtMs = filedCounts.map((_, i) => base + i * DAY_MS);
        const closedAtMs = closedCounts.map((_, i) => base + i * DAY_MS + 3600000);
        const nowMs = base + Math.max(filedCounts.length, closedCounts.length, 1) * DAY_MS;
        const result = computeIntakeBalance({ filedAtMs, closedAtMs }, nowMs, 30);
        for (const p of result.dailySeries) {
          assert.equal(p.net, p.filed - p.closed);
        }
      }
    ),
    { numRuns: 40 }
  );
});

test('BL-599 P3: buildable ticket and INTAKE paths increment filed only', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 9999 }), (n) => {
      const events = deriveIntakeBalanceEvents([
        commit('2026-01-01T00:00:00Z', [{ status: 'A', path: `backlog/active/BL-${n}-ticket.yaml` }]),
        commit('2026-01-02T00:00:00Z', [{ status: 'A', path: `backlog/INTAKE-20260102-${n}.md` }]),
      ]);
      assert.equal(events.filedAtMs.length, 2);
      assert.equal(events.closedAtMs.length, 0);
    }),
    { numRuns: 20 }
  );
});
