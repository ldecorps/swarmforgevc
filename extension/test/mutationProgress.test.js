const assert = require('node:assert/strict');
const {
  initMutationProgressState,
  recordMutantTested,
  buildProgressRecord,
} = require('../out/mutation/mutationProgress');

const START = new Date('2026-07-09T12:00:00Z').getTime();

test('initMutationProgressState starts at zero tested/killed/survived/timedOut', () => {
  const state = initMutationProgressState(10, START);
  assert.deepEqual(state, { total: 10, tested: 0, killed: 0, survived: 0, timedOut: 0, startedAtMs: START });
});

test('recordMutantTested increments tested and survived for a Survived result', () => {
  const state = initMutationProgressState(10, START);
  const next = recordMutantTested(state, 'Survived');
  assert.equal(next.tested, 1);
  assert.equal(next.killed, 0);
  assert.equal(next.survived, 1);
  assert.equal(next.timedOut, 0);
});

test('recordMutantTested increments tested and timedOut for a Timeout result', () => {
  const state = initMutationProgressState(10, START);
  const next = recordMutantTested(state, 'Timeout');
  assert.equal(next.tested, 1);
  assert.equal(next.killed, 0);
  assert.equal(next.survived, 0);
  assert.equal(next.timedOut, 1);
});

// BL-446: killed is the mutation gate's own health signal (mutationGateHealth.ts) - a Killed
// result must actually increment it, not just leave survived/timedOut at zero.
test('recordMutantTested increments tested and killed for a Killed result', () => {
  const state = initMutationProgressState(10, START);
  const next = recordMutantTested(state, 'Killed');
  assert.equal(next.tested, 1);
  assert.equal(next.killed, 1);
  assert.equal(next.survived, 0);
  assert.equal(next.timedOut, 0);
});

test('recordMutantTested does not mutate the input state (pure)', () => {
  const state = initMutationProgressState(10, START);
  recordMutantTested(state, 'Survived');
  assert.equal(state.tested, 0);
});

test('buildProgressRecord reports 0 percent, null eta, and status running at the very start', () => {
  const state = initMutationProgressState(10, START);
  const record = buildProgressRecord(state, START);
  assert.equal(record.tested, 0);
  assert.equal(record.total, 10);
  assert.equal(record.percent, 0);
  assert.equal(record.elapsed_s, 0);
  assert.equal(record.eta_s, null);
  assert.equal(record.status, 'running');
  assert.equal(record.updated_at, new Date(START).toISOString());
});

test('buildProgressRecord computes percent from tested/total', () => {
  let state = initMutationProgressState(4, START);
  state = recordMutantTested(state, 'Killed');
  const record = buildProgressRecord(state, START + 1000);
  assert.equal(record.percent, 25);
});

test('buildProgressRecord projects eta_s from elapsed-per-tested-mutant times the remaining count', () => {
  let state = initMutationProgressState(4, START);
  state = recordMutantTested(state, 'Killed');
  // 10s elapsed for 1/4 tested -> 10s/mutant * 3 remaining = 30s eta
  const record = buildProgressRecord(state, START + 10_000);
  assert.equal(record.elapsed_s, 10);
  assert.equal(record.eta_s, 30);
});

test('buildProgressRecord reports eta_s of 0 and percent 100 once every mutant is tested', () => {
  let state = initMutationProgressState(2, START);
  state = recordMutantTested(state, 'Killed');
  state = recordMutantTested(state, 'Survived');
  const record = buildProgressRecord(state, START + 20_000);
  assert.equal(record.percent, 100);
  assert.equal(record.eta_s, 0);
  assert.equal(record.survived, 1);
});

test('buildProgressRecord reports 0 percent and null eta when total is 0 (nothing to mutate)', () => {
  const state = initMutationProgressState(0, START);
  const record = buildProgressRecord(state, START);
  assert.equal(record.percent, 0);
  assert.equal(record.eta_s, null);
});

test('buildProgressRecord defaults status to running and accepts an explicit status/file override', () => {
  const state = initMutationProgressState(1, START);
  const record = buildProgressRecord(state, START, { file: 'src/foo.ts', status: 'done' });
  assert.equal(record.status, 'done');
  assert.equal(record.file, 'src/foo.ts');
});

test('buildProgressRecord leaves file undefined when not given', () => {
  const state = initMutationProgressState(1, START);
  const record = buildProgressRecord(state, START);
  assert.equal(record.file, undefined);
});

// ── BL-446: health is only classified once the run is done ─────────────────

test('buildProgressRecord leaves health undefined while the run is still running', () => {
  let state = initMutationProgressState(4, START);
  state = recordMutantTested(state, 'Survived');
  const record = buildProgressRecord(state, START + 1000);
  assert.equal(record.status, 'running');
  assert.equal(record.health, undefined);
});

test('buildProgressRecord classifies a done run with kills as healthy', () => {
  let state = initMutationProgressState(2, START);
  state = recordMutantTested(state, 'Killed');
  state = recordMutantTested(state, 'Survived');
  const record = buildProgressRecord(state, START + 1000, { status: 'done' });
  assert.equal(record.health, 'healthy');
  assert.equal(record.killed, 1);
});

test('buildProgressRecord classifies a done run with zero kills and survivors as zero-kill-suspect', () => {
  let state = initMutationProgressState(1, START);
  state = recordMutantTested(state, 'Survived');
  const record = buildProgressRecord(state, START + 1000, { status: 'done' });
  assert.equal(record.health, 'zero-kill-suspect');
});

test('buildProgressRecord classifies a done run with nothing tested as no-mutants', () => {
  const state = initMutationProgressState(0, START);
  const record = buildProgressRecord(state, START, { status: 'done' });
  assert.equal(record.health, 'no-mutants');
});
