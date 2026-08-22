const assert = require('node:assert/strict');
const { mkTmpDir } = require('./helpers/tmpDir');
const { runClosingCeremony } = require('../out/metrics/closingCeremonyRun');
const { readCeremonyRun } = require('../out/metrics/closingCeremonyStore');
const { appendLeanLedgerEventIfNew } = require('../out/metrics/leanLedgerStore');
const { recordCeremonyOutcome } = require('../out/metrics/closingCeremonyStore');

// BL-820: the orchestrator "the shift-close path reaches its lean step"
// actually runs - composed from leanLedgerStore.ts's ledger and
// closingCeremony.ts's pure fold. `sendNote` is injected (never the real
// swarm_handoff.sh here - extension/src/tools/closing-ceremony-run.ts's own
// wiring to the real transport is proven by BL-820's acceptance scenario 06
// instead).

function mkTmp() {
  return mkTmpDir('sfvc-closing-ceremony-run-');
}

function fakeDeps() {
  const sent = [];
  return { deps: { sendNote: (target, draft) => sent.push({ target, draft }) }, sent };
}

test('an empty shift auto-records an explicit no-change outcome, and sends no note', () => {
  const target = mkTmp();
  const { deps, sent } = fakeDeps();
  const result = runClosingCeremony(target, '2026-08-08T22:00:00.000Z', deps);
  assert.equal(result.status, 'auto_no_change');
  assert.equal(result.run.outcome.type, 'no_change');
  assert.equal(sent.length, 0);
});

test('a non-empty shift creates a pending run and delivers a note to the specifier', () => {
  const target = mkTmp();
  appendLeanLedgerEventIfNew(target, {
    ticket: 'BL-900',
    type: 'stage_transition',
    source: 'stage-dwell',
    at: '2026-08-08T09:00:00.000Z',
    role: 'coder',
    data: { processingMs: 1000 },
  });
  const { deps, sent } = fakeDeps();
  const result = runClosingCeremony(target, '2026-08-08T22:00:00.000Z', deps);
  assert.equal(result.status, 'created');
  assert.equal(result.run.outcome, null);
  assert.equal(sent.length, 1);
  assert.match(sent[0].draft, /to: specifier/);
  assert.match(sent[0].draft, /2026-08-08\.json/);
});

test('running the ceremony twice for the same shift is idempotent - no duplicate note', () => {
  const target = mkTmp();
  appendLeanLedgerEventIfNew(target, {
    ticket: 'BL-900',
    type: 'stage_transition',
    source: 'stage-dwell',
    at: '2026-08-08T09:00:00.000Z',
    role: 'coder',
    data: { processingMs: 1000 },
  });
  const { deps, sent } = fakeDeps();
  runClosingCeremony(target, '2026-08-08T22:00:00.000Z', deps);
  const second = runClosingCeremony(target, '2026-08-08T23:00:00.000Z', deps);
  assert.equal(second.status, 'already_exists');
  assert.equal(sent.length, 1, 'expected no second note on a re-run for the same shift');
});

test('a prior shift left pending is finalized as failed, and surfaced, when a later shift runs', () => {
  const target = mkTmp();
  appendLeanLedgerEventIfNew(target, {
    ticket: 'BL-900',
    type: 'stage_transition',
    source: 'stage-dwell',
    at: '2026-08-06T09:00:00.000Z',
    role: 'coder',
    data: { processingMs: 1000 },
  });
  const { deps, sent } = fakeDeps();
  runClosingCeremony(target, '2026-08-06T22:00:00.000Z', deps); // creates a pending run for 2026-08-06, never given an outcome

  const result = runClosingCeremony(target, '2026-08-08T22:00:00.000Z', deps); // a later shift, no gap-day activity
  assert.deepEqual(result.finalizedFailed, ['2026-08-06']);
  const stale = readCeremonyRun(target, '2026-08-06');
  assert.ok(stale.failedAt, 'expected the stale run to be finalized as failed');
  assert.ok(
    sent.some((s) => /FAILED/.test(s.draft) && s.draft.includes('2026-08-06')),
    'expected a failure note surfacing the silent ceremony'
  );
});

test('a prior shift that DID receive an outcome before the next shift runs is left complete, not touched', () => {
  const target = mkTmp();
  appendLeanLedgerEventIfNew(target, {
    ticket: 'BL-900',
    type: 'stage_transition',
    source: 'stage-dwell',
    at: '2026-08-06T09:00:00.000Z',
    role: 'coder',
    data: { processingMs: 1000 },
  });
  const { deps, sent } = fakeDeps();
  runClosingCeremony(target, '2026-08-06T22:00:00.000Z', deps);
  recordCeremonyOutcome(target, '2026-08-06', { type: 'no_change', ref: null, recordedAt: '2026-08-06T23:00:00.000Z' });

  const result = runClosingCeremony(target, '2026-08-08T22:00:00.000Z', deps);
  assert.deepEqual(result.finalizedFailed, []);
  assert.equal(readCeremonyRun(target, '2026-08-06').failedAt, null);
});
