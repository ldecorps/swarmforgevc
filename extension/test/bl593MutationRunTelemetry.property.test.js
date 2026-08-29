'use strict';

const fc = require('fast-check');
const assert = require('node:assert/strict');
const {
  buildMutationRunRecord,
  isCompletedFullRunRecord,
} = require('../out/mutation/mutationRunTelemetry');
const { initMutationProgressState } = require('../out/mutation/mutationProgress');

const START = Date.parse('2026-01-01T00:00:00Z');
const { nonBlankScope } = require('./support/bl593ScopeArb');

test('property: completed records always carry load-bearing scope total and incremental', () => {
  fc.assert(
    fc.property(
      nonBlankScope,
      fc.integer({ min: 0, max: 5000 }),
      fc.boolean(),
      fc.integer({ min: 1, max: 32 }),
      (scope, total, incremental, concurrency) => {
        const state = initMutationProgressState(total, START);
        const record = buildMutationRunRecord(state, START + 60_000, {
          role: 'coder',
          scope,
          incremental,
          concurrency,
          buildSha: 'sha',
        });
        assert.equal(record.scope, scope);
        assert.equal(record.total, total);
        assert.equal(record.incremental, incremental);
      }
    )
  );
});

test('property: aborted records are never classified as completed full runs', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 100 }), (total) => {
      const state = initMutationProgressState(total, START);
      const record = buildMutationRunRecord(
        state,
        START + 1000,
        { role: 'coder', scope: 'out/**/*.js', incremental: false, concurrency: 1, buildSha: 'x' },
        { aborted: true }
      );
      assert.equal(isCompletedFullRunRecord(record), false);
    })
  );
});
