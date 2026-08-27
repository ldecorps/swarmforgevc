const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  readBounceRecords,
  readRawBounceRecords,
  readBounceCorrections,
  appendBounceRecordIfNew,
  appendBounceCorrectionIfNew,
  bouncesDir,
} = require('../out/metrics/bounceStore');
const { recordsFromQaBounceJsonl } = require('../out/metrics/failureModeInventory');
const { computeBounceTallyByBouncingRole } = require('../out/quality/qaBounce');
const { parseArgs } = require('../out/tools/recordBounceCorrectionArgs');

// BL-990: the correction must reach EVERY consumer, and the four named ones
// do not share a reader - readBounceRecords, failureModeInventory's own
// JSONL parse, and leanLedger's ticket-YAML path are three separate routes
// over the same events. A correction honoured by one and ignored by another
// yields two bounce rates from one store, which the ticket calls out as
// worse than today's single wrong number.

const BOUNCE = {
  ticket: 'BL-971',
  producingRole: 'coder',
  ticketType: 'defect',
  failureClass: 'acceptance',
  commit: '8956d30eee',
  by: 'QA',
  at: '2026-08-20T13:45:00.000Z',
};

const CORRECTION = {
  kind: 'bounce-correction',
  ticket: 'BL-971',
  commit: '8956d30eee',
  at: '2026-08-20T14:00:00.000Z',
  by: 'QA',
  reason: 'misattributed - a mid-flight spec amendment caused this, not the coder',
};

function storeWithBounce(extra = []) {
  const root = mkTmpDir('bl990-store-');
  appendBounceRecordIfNew(root, BOUNCE);
  for (const r of extra) {
    appendBounceRecordIfNew(root, r);
  }
  return root;
}

const monthFile = (root) => path.join(bouncesDir(root), '2026-08.jsonl');
const readLines = (root) => fs.readFileSync(monthFile(root), 'utf8').split('\n').filter(Boolean);

// ── scenario 01: supersede without altering ──────────────────────────────

test('BL-990 sc01: a correction leaves the original line byte-for-byte and is appended AFTER it', () => {
  const root = storeWithBounce();
  const before = readLines(root);
  assert.equal(before.length, 1);

  assert.equal(appendBounceCorrectionIfNew(root, CORRECTION), true);

  const after = readLines(root);
  assert.equal(after.length, 2, 'the store grew by exactly one line');
  assert.equal(after[0], before[0], 'the original record is unchanged, byte for byte');
  assert.deepEqual(JSON.parse(after[1]), CORRECTION, 'the correction follows it');
  // The audit trail keeps the misattribution visible.
  assert.deepEqual(readRawBounceRecords(root), [BOUNCE]);
  assert.deepEqual(readBounceCorrections(root), [CORRECTION]);
});

// ── scenario 02: every consumer resolves supersession ────────────────────

test('BL-990 sc02: readBounceRecords (reworkRounds / costHealthSidecar / qa-bounce-line) stops reporting the corrected bounce', () => {
  const root = storeWithBounce();
  assert.equal(readBounceRecords(root).length, 1);
  appendBounceCorrectionIfNew(root, CORRECTION);
  assert.deepEqual(readBounceRecords(root), [], 'the corrected bounce is no longer attributed');
});

test('BL-990 sc02: failureModeInventory - which parses the JSONL itself - stops emitting the signature', () => {
  const root = storeWithBounce();
  const contentBefore = fs.readFileSync(monthFile(root), 'utf8');
  assert.deepEqual(
    recordsFromQaBounceJsonl(contentBefore).map((r) => r.signature),
    ['qa_bounce:acceptance:coder']
  );
  appendBounceCorrectionIfNew(root, CORRECTION);
  const contentAfter = fs.readFileSync(monthFile(root), 'utf8');
  assert.deepEqual(recordsFromQaBounceJsonl(contentAfter), [], 'no signature blames the coder any more');
});

test('BL-990 sc02: a correction never suppresses a DIFFERENT bounce - only the ticket+commit it names', () => {
  const sibling = { ...BOUNCE, commit: 'ffffffffff', at: '2026-08-20T15:00:00.000Z' };
  const otherTicket = { ...BOUNCE, ticket: 'BL-42', commit: 'aaaaaaaaaa', at: '2026-08-20T16:00:00.000Z' };
  const root = storeWithBounce([sibling, otherTicket]);
  appendBounceCorrectionIfNew(root, CORRECTION);
  assert.deepEqual(
    readBounceRecords(root).map((r) => `${r.ticket}@${r.commit}`),
    ['BL-971@ffffffffff', 'BL-42@aaaaaaaaaa']
  );
  const content = fs.readFileSync(monthFile(root), 'utf8');
  assert.equal(recordsFromQaBounceJsonl(content).length, 2, 'the inventory keeps the two uncorrected bounces');
});

// ── scenario 03: a reason is required ────────────────────────────────────

test('BL-990 sc03: a correction with no reason is refused and the store is unchanged', () => {
  const root = storeWithBounce();
  const before = fs.readFileSync(monthFile(root), 'utf8');
  const { reason, ...noReason } = CORRECTION;
  assert.equal(appendBounceCorrectionIfNew(root, noReason), false);
  assert.equal(appendBounceCorrectionIfNew(root, { ...CORRECTION, reason: '   ' }), false);
  assert.equal(fs.readFileSync(monthFile(root), 'utf8'), before, 'nothing was written');
  assert.equal(readBounceRecords(root).length, 1, 'the bounce is still attributed');
});

test('BL-990 sc03: the CLI refuses a reasonless invocation at parse time, before anything is written', () => {
  assert.equal(parseArgs(['--ticket', 'BL-971', '--commit', '8956d30eee', '--by', 'QA']), null);
  assert.equal(parseArgs(['--ticket', 'BL-971', '--commit', '8956d30eee', '--by', 'QA', '--reason', '  ']), null);
  assert.deepEqual(parseArgs(['--ticket', 'BL-971', '--commit', '8956d30eee', '--by', 'QA', '--reason', 'because']), {
    ticket: 'BL-971',
    commit: '8956d30eee',
    reason: 'because',
    by: 'QA',
  });
});

test('BL-990 sc03: the CLI refuses an unknown --by, and accepts the specifier', () => {
  assert.equal(parseArgs(['--ticket', 'BL-1', '--commit', 'abc', '--by', 'nobody', '--reason', 'x']), null);
  assert.equal(parseArgs(['--ticket', 'BL-1', '--commit', 'abc', '--by', 'specifier', '--reason', 'x']).by, 'specifier');
});

// ── scenario 04: the count falls by one, the store grows by one ──────────

test('BL-990 sc04: the blamed role loses exactly one bounce that day while the store gains exactly one line', () => {
  const root = storeWithBounce();
  const linesBefore = readLines(root).length;
  const tallyBefore = computeBounceTallyByBouncingRole(readBounceRecords(root));
  const coderBefore = tallyBefore.find((t) => t.role === 'QA')?.count ?? 0;

  appendBounceCorrectionIfNew(root, CORRECTION);

  const linesAfter = readLines(root).length;
  const attributedAfter = readBounceRecords(root).filter((r) => r.producingRole === 'coder' && r.at.startsWith('2026-08-20'));
  assert.equal(linesAfter, linesBefore + 1, 'total records rose by exactly one');
  assert.equal(attributedAfter.length, 0, "the blamed role's count for that day fell by exactly one");
  assert.equal(coderBefore, 1, 'precondition: it was counted before the correction');
});

// ── scenario 05: recording the same correction twice is a no-op ──────────

test('BL-990 sc05: an identical correction recorded twice leaves the store byte-identical', () => {
  const root = storeWithBounce();
  assert.equal(appendBounceCorrectionIfNew(root, CORRECTION), true);
  const after = fs.readFileSync(monthFile(root), 'utf8');
  assert.equal(appendBounceCorrectionIfNew(root, CORRECTION), false, 'the second call reports it wrote nothing');
  assert.equal(fs.readFileSync(monthFile(root), 'utf8'), after, 'and really wrote nothing');
});

test('BL-990: re-recording a CORRECTED bounce does not resurrect it - the append dedup reads the raw history', () => {
  const root = storeWithBounce();
  appendBounceCorrectionIfNew(root, CORRECTION);
  assert.equal(appendBounceRecordIfNew(root, BOUNCE), false, 'the bounce is still in the store, so it is still a duplicate');
  assert.deepEqual(readBounceRecords(root), [], 'and it stays unattributed');
});

// ── scenario 02, the THIRD read path: leanLedger reads the ticket YAML ────

const { composeBounceEvents } = require('../out/metrics/leanLedgerComposeBounce');

function storeWithTicketYaml() {
  const root = mkTmpDir('bl990-ledger-');
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-971-property-lane.yaml'),
    [
      'id: BL-971',
      'bounce_count: 2',
      'bounce_history:',
      '  - { at: 2026-08-20, by: QA, blamed: coder, class: acceptance, commit: 8956d30eee, evidence: backlog/evidence/BL-971-a.md }',
      '  - { at: 2026-08-20, by: QA, blamed: coder, class: unit, commit: ffffffffff, evidence: backlog/evidence/BL-971-b.md }',
      '',
    ].join('\n')
  );
  appendBounceRecordIfNew(root, BOUNCE);
  return root;
}

test('BL-990 sc02: leanLedgerComposeBounce - which reads the ticket YAML, not the JSONL - stops reporting the corrected event', () => {
  const root = storeWithTicketYaml();
  const before = composeBounceEvents(root, 'BL-971');
  assert.deepEqual(before.map((e) => e.data.commit), ['8956d30eee', 'ffffffffff']);

  appendBounceCorrectionIfNew(root, CORRECTION);

  const after = composeBounceEvents(root, 'BL-971');
  assert.deepEqual(after.map((e) => e.data.commit), ['ffffffffff'], 'only the corrected event is withdrawn');
  assert.equal(after.every((e) => e.data.blamedRole === 'coder'), true, 'the surviving event is untouched');
});
