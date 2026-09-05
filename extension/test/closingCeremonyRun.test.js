const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { runClosingCeremony, readOpenTicketTextsFromTarget } = require('../out/metrics/closingCeremonyRun');
const { readCeremonyRun } = require('../out/metrics/closingCeremonyStore');
const { appendLeanLedgerEventIfNew } = require('../out/metrics/leanLedgerStore');
const { recordCeremonyOutcome } = require('../out/metrics/closingCeremonyStore');
const { writeRitualLedger } = require('../out/metrics/ritualLedgerProducer');

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

test('BL-1119: runClosingCeremony with auto window model holds despite stalls (wired path)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const target = mkTmp();
  const packs = path.join(target, 'swarmforge', 'packs');
  fs.mkdirSync(packs, { recursive: true });
  const packConf = path.join(packs, 'demo.conf');
  fs.writeFileSync(packConf, 'window coder cursor coder --model auto\n');
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(target, '.swarmforge', 'swarm-identity'),
    `active_backlog_max_depth_conf_path\t${packConf}\n`
  );
  appendLeanLedgerEventIfNew(target, {
    ticket: 'BL-1119',
    type: 'stall',
    source: 'chaser-telemetry',
    at: '2026-08-08T09:00:00.000Z',
    role: 'coder',
    data: { eventType: 'chase', count: 1 },
  });
  const { deps } = fakeDeps();
  const result = runClosingCeremony(target, '2026-08-08T22:00:00.000Z', deps);
  const rec = result.run.packet.qualityRecommendations.find((r) => r.role === 'coder');
  assert.ok(rec);
  assert.equal(rec.dial, 'hold');
  assert.equal(rec.disposition, 'held');
});

test('BL-1119: runClosingCeremony without window models still raises on stalls (compat)', () => {
  const target = mkTmp();
  appendLeanLedgerEventIfNew(target, {
    ticket: 'BL-1119',
    type: 'stall',
    source: 'chaser-telemetry',
    at: '2026-08-08T09:00:00.000Z',
    role: 'coder',
    data: { eventType: 'chase', count: 1 },
  });
  const { deps } = fakeDeps();
  deps.readWindowModels = () => ({});
  const result = runClosingCeremony(target, '2026-08-08T22:00:00.000Z', deps);
  const rec = result.run.packet.qualityRecommendations.find((r) => r.role === 'coder');
  assert.equal(rec.dial, 'raise');
});

// BL-1365: readOpenTicketTextsFromTarget is the real default loader
// runClosingCeremony falls back to; every existing test in this file injects
// no override, so it always runs against a scratch target with no
// backlog/active or backlog/paused at all - only the "directory missing"
// catch branch was ever exercised. Direct tests for the branches that
// require real ticket files.
test('readOpenTicketTextsFromTarget reads .yaml ticket text from both active and paused, skipping non-yaml', () => {
  const target = mkTmp();
  fs.mkdirSync(path.join(target, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(target, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(path.join(target, 'backlog', 'active', 'BL-1.yaml'), 'id: BL-1\nritual_class: backlog-closure\n');
  fs.writeFileSync(path.join(target, 'backlog', 'active', 'README.md'), 'not a ticket');
  fs.writeFileSync(path.join(target, 'backlog', 'paused', 'BL-2.yaml'), 'id: BL-2\n');

  const texts = readOpenTicketTextsFromTarget(target).sort();

  assert.deepEqual(texts, ['id: BL-1\nritual_class: backlog-closure\n', 'id: BL-2\n'].sort());
});

test('readOpenTicketTextsFromTarget fails open on an unreadable ticket file, rather than throwing', () => {
  const target = mkTmp();
  fs.mkdirSync(path.join(target, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(target, 'backlog', 'active', 'BL-1.yaml'), 'id: BL-1\n');
  // A directory named *.yaml: readFileSync throws EISDIR on it, the shape of
  // "present but unreadable" this function must swallow rather than crash on.
  fs.mkdirSync(path.join(target, 'backlog', 'active', 'BL-2.yaml'));

  const texts = readOpenTicketTextsFromTarget(target);

  assert.deepEqual(texts, ['id: BL-1\n'], 'the unreadable entry must be skipped, not crash the whole read');
});

test('readOpenTicketTextsFromTarget returns [] when neither backlog directory exists', () => {
  const target = mkTmp();
  assert.deepEqual(readOpenTicketTextsFromTarget(target), []);
});

// BL-1365 hardening: resolveDeterminismCandidates (the pure-read/select step
// split out of runClosingCeremony) had zero coverage of its non-empty path -
// every scenario above never persists a ritual ledger, so ledgerRecord is
// always null and the function short-circuits at `if (!ledgerRecord) return
// []` before its own body (the ?? fallback, the fold call) ever runs. These
// three write a real ledger record via the same writeRitualLedger the
// producer uses, so the candidate must actually flow through
// resolveDeterminismCandidates and buildClosingCeremonyPacket to be seen.
function writeCandidateLedger(target) {
  writeRitualLedger(path.join(target, '.swarmforge', 'telemetry'), {
    computedAt: '2026-09-05T00:00:00.000Z',
    windowDays: 45,
    commitsScanned: 100,
    ledger: [
      {
        ritualClass: 'pass-bounce-evidence',
        label: 'pass/bounce evidence',
        commits: 100,
        topSubject: 'record pass evidence',
        topSubjectCount: 5,
        dominance: 0.05,
        distinctSubjects: 80,
      },
    ],
  });
}

test('BL-1365: a persisted ledger candidate reaches the packet (default readOpenTicketTexts, none open)', () => {
  const target = mkTmp();
  writeCandidateLedger(target);
  const { deps } = fakeDeps();
  // No backlog/active or backlog/paused directory at all - nothing suppresses.
  const result = runClosingCeremony(target, '2026-09-05T22:00:00.000Z', deps);
  // A determinism candidate alone (no lean-ledger activity at all) is enough
  // to make the packet non-empty - proves isEmptyCeremonyPacket's own
  // determinismCandidates check as well as the resolve step.
  assert.equal(result.status, 'created');
  assert.deepEqual(
    result.run.packet.determinismCandidates.map((c) => c.ritualClass),
    ['pass-bounce-evidence']
  );
});

test('BL-1365: an open ticket naming the ritual_class (via the real backlog reader) suppresses the candidate', () => {
  const target = mkTmp();
  writeCandidateLedger(target);
  fs.mkdirSync(path.join(target, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(target, 'backlog', 'active', 'BL-9.yaml'), 'id: BL-9\nritual_class: pass-bounce-evidence\n');
  const { deps } = fakeDeps();
  const result = runClosingCeremony(target, '2026-09-05T22:00:00.000Z', deps);
  assert.equal(result.status, 'auto_no_change', 'the suppressed candidate leaves nothing else to report');
  assert.deepEqual(result.run.packet.determinismCandidates, []);
});

test('BL-1365: an injected deps.readOpenTicketTexts is honored in place of the real backlog reader', () => {
  const target = mkTmp();
  writeCandidateLedger(target);
  // No backlog/active or backlog/paused on disk at all - if the injected
  // override were ignored in favor of the default reader, this ticket text
  // would never be seen and the candidate would wrongly survive.
  const { deps } = fakeDeps();
  deps.readOpenTicketTexts = () => ['ritual_class: pass-bounce-evidence'];
  const result = runClosingCeremony(target, '2026-09-05T22:00:00.000Z', deps);
  assert.equal(result.status, 'auto_no_change');
  assert.deepEqual(result.run.packet.determinismCandidates, []);
});
