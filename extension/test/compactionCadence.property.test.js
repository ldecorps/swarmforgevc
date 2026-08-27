'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  deriveCompactionRecordFromContextEvent,
  deriveCompactionRecords,
  queryCompactionCadenceForRole,
} = require('../out/metrics/compactionCadence');

test('BL-601 P1: only compaction:true events produce records', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1000, max: 500000 }), (inputTokens) => {
      const noRecord = deriveCompactionRecordFromContextEvent({
        role: 'coder',
        model: 'claude-sonnet-5',
        timestamp: '2026-08-27T06:00:00Z',
        compaction: false,
        contextUtilizationPct: 50,
        inputTokens,
      });
      assert.equal(noRecord, null);
    }),
    { numRuns: 20 }
  );
});

test('BL-601 P2: compaction record tokens equal input tokens on event', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 500000 }), (inputTokens) => {
      const record = deriveCompactionRecordFromContextEvent({
        role: 'QA',
        model: 'gpt-5',
        timestamp: '2026-08-27T07:15:00Z',
        compaction: true,
        contextUtilizationPct: 88,
        inputTokens,
      });
      assert.ok(record);
      assert.equal(record.tokensAtCompaction, inputTokens);
    }),
    { numRuns: 30 }
  );
});

test('BL-601 P3: undetectable roles never report fabricated zero windows', () => {
  fc.assert(
    fc.property(fc.constant('documenter'), (role) => {
      const series = queryCompactionCadenceForRole(role, [], ['coder', 'QA'], Date.now());
      assert.equal(series.applicable, false);
      assert.equal(series.windows.length, 0);
    }),
    { numRuns: 5 }
  );
});

test('BL-601 P4: spinner-only input yields empty record list', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 40 }), (spinnerText) => {
      const records = deriveCompactionRecords({ spinnerText, contextEvents: [] });
      assert.equal(records.length, 0);
    }),
    { numRuns: 20 }
  );
});
