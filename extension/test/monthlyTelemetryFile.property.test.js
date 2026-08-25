/**
 * BL-987 / BL-336 invariant 2: monthlyTelemetryFile derives chaser-<YYYY-MM>
 * from the sample timestamp — never a pinned calendar-month literal.
 * Crossing month boundaries must change the basename (generator reachability).
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fc = require('fast-check');
const { monthlyTelemetryFile } = require('../out/metrics/resourceTelemetry');

describe('monthlyTelemetryFile (BL-987 invariant 2)', () => {
  it('basename always matches the UTC month of atMs across month boundaries', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 48 }), (monthsAhead) => {
        const atMs = Date.UTC(2026, 0, 15) + monthsAhead * 30 * 24 * 60 * 60 * 1000;
        const monthKey = new Date(atMs).toISOString().slice(0, 7);
        const filePath = monthlyTelemetryFile('/tmp/sf-root', atMs);
        assert.equal(path.basename(filePath), `chaser-${monthKey}.jsonl`);
      }),
      { numRuns: 49 }
    );
    // Reachability: January and a later month must disagree (not a pinned archive).
    const jan = path.basename(monthlyTelemetryFile('/tmp/sf-root', Date.UTC(2026, 0, 15)));
    const sep = path.basename(monthlyTelemetryFile('/tmp/sf-root', Date.UTC(2026, 8, 15)));
    assert.equal(jan, 'chaser-2026-01.jsonl');
    assert.equal(sep, 'chaser-2026-09.jsonl');
    assert.notEqual(jan, sep);
  });
});
