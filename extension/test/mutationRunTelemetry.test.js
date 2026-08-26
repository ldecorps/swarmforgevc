'use strict';

const assert = require('node:assert/strict');
const {
  buildMutationRunRecord,
  resolveMutationRunMeta,
  isCompletedFullRunRecord,
} = require('../out/mutation/mutationRunTelemetry');
const { initMutationProgressState, recordMutantTested } = require('../out/mutation/mutationProgress');

const START = Date.parse('2026-07-09T12:00:00Z');
const END = START + 125_000;

const META = {
  role: 'hardender',
  worktree: 'hardener',
  scope: 'out/concierge/pipelineBoard.js',
  incremental: true,
  concurrency: 8,
  buildSha: 'abc123def4',
};

test('buildMutationRunRecord carries timing scope concurrency and kill stats', () => {
  let state = initMutationProgressState(42, START);
  state = recordMutantTested(state, 'Killed');
  state = recordMutantTested(state, 'Survived');
  state = recordMutantTested(state, 'NoCoverage');
  state = recordMutantTested(state, 'Ignored');
  state = recordMutantTested(state, 'Timeout');
  const record = buildMutationRunRecord(state, END, META);
  assert.equal(record.started_at, new Date(START).toISOString());
  assert.equal(record.ended_at, new Date(END).toISOString());
  assert.equal(record.elapsed_s, 125);
  assert.equal(record.role, 'hardender');
  assert.equal(record.worktree, 'hardener');
  assert.equal(record.scope, META.scope);
  assert.equal(record.total, 42);
  assert.equal(record.incremental, true);
  assert.equal(record.concurrency, 8);
  assert.equal(record.killed, 1);
  assert.equal(record.survived, 1);
  assert.equal(record.no_coverage, 1);
  assert.equal(record.ignored, 1);
  assert.equal(record.timed_out, 1);
  assert.equal(record.build_sha, 'abc123def4');
  assert.equal(record.aborted, undefined);
});

test('buildMutationRunRecord marks aborted runs without pretending they completed cleanly', () => {
  const state = initMutationProgressState(10, START);
  const record = buildMutationRunRecord(state, END, META, { aborted: true });
  assert.equal(record.aborted, true);
  assert.equal(isCompletedFullRunRecord(record), false);
});

test('resolveMutationRunMeta reads scope incremental concurrency and build sha from env', () => {
  const meta = resolveMutationRunMeta(
    {
      STRYKER_MUTATE_FILE: 'out/foo.js',
      STRYKER_INCREMENTAL: '1',
      MUTATION_CONCURRENCY: '8',
      SWARMFORGE_BUILD_SHA: 'deadbeef01',
      SWARMFORGE_WORKTREE: 'coder',
    },
    'coder'
  );
  assert.equal(meta.scope, 'out/foo.js');
  assert.equal(meta.incremental, true);
  assert.equal(meta.concurrency, 8);
  assert.equal(meta.buildSha, 'deadbeef01');
  assert.equal(meta.worktree, 'coder');
});
