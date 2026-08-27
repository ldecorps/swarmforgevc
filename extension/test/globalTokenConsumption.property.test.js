'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  aggregateGlobalTokenBuckets,
  totalTokensFromRecord,
} = require('../out/metrics/globalTokenConsumption');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BASE = Date.parse('2026-07-01T00:00:00.000Z');

function mkRecord(tokens, atMs) {
  return {
    messageId: `m-${tokens}-${atMs}`,
    timestampMs: atMs,
    model: 'claude-sonnet-5',
    usage: { inputTokens: tokens, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
  };
}

test('BL-605 P1: bucket totals equal per-role transcript sums when complete', () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 1, max: 500 }), { minLength: 1, maxLength: 6 }),
      fc.array(fc.integer({ min: 1, max: 500 }), { minLength: 1, maxLength: 6 }),
      (coderTokens, cleanerTokens) => {
        const at = BASE;
        const recordsByRole = {
          coder: coderTokens.map((t) => mkRecord(t, at)),
          cleaner: cleanerTokens.map((t) => mkRecord(t, at)),
        };
        const expected = coderTokens.reduce((s, t) => s + t, 0) + cleanerTokens.reduce((s, t) => s + t, 0);
        const buckets = aggregateGlobalTokenBuckets({
          recordsByRole,
          expectedRoles: ['coder', 'cleaner'],
          bucketMs: DAY,
        });
        assert.equal(buckets.length, 1);
        assert.equal(buckets[0].incomplete, false);
        assert.equal(buckets[0].totalTokens, expected);
      }
    ),
    { numRuns: 40 }
  );
});

test('BL-605 P2: missing role in bucket marks incomplete, never a silent zero total', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 1000 }), (tokens) => {
      const buckets = aggregateGlobalTokenBuckets({
        recordsByRole: { coder: [mkRecord(tokens, BASE)] },
        expectedRoles: ['coder', 'cleaner'],
        bucketMs: DAY,
      });
      assert.equal(buckets[0].incomplete, true);
      assert.equal(buckets[0].totalTokens, null);
    }),
    { numRuns: 20 }
  );
});

test('BL-605 P3: totalTokensFromRecord matches burnRate-style field sum', () => {
  fc.assert(
    fc.property(
      fc.nat(200),
      fc.nat(200),
      fc.nat(50),
      fc.nat(50),
      (input, output, cacheCreate, cacheRead) => {
        const rec = mkRecord(0, BASE);
        rec.usage = {
          inputTokens: input,
          outputTokens: output,
          cacheCreationTokens: cacheCreate,
          cacheReadTokens: cacheRead,
        };
        assert.equal(totalTokensFromRecord(rec), input + output + cacheCreate + cacheRead);
      }
    ),
    { numRuns: 40 }
  );
});
