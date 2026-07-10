const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { backfillHumanApprovalText, runHumanApprovalBackfill } = require('../out/tools/backfill-human-approval');

// BL-251 backfill-seeds-field-05: a one-time, idempotent migration seeding
// the structured human_approval field on live tickets from their existing
// free-text "# HUMAN APPROVAL:" comment block - the SAME multi-line
// comment shape real tickets in this repo already use (a header line plus
// consecutive '#'-prefixed continuation lines). Touches only backlog/active
// and backlog/paused, never backlog/done. Never clobbers a human's later
// edit: any file that already carries a human_approval: line is skipped
// entirely, regardless of its value.

// ── backfillHumanApprovalText (pure) ──────────────────────────────────────

test('a comment block marking the ticket "PENDING human review" seeds human_approval: pending', () => {
  const raw = [
    'id: BL-900',
    'title: t',
    '',
    '# HUMAN APPROVAL: feature file specs/features/BL-900.feature is a NEW draft',
    '# authored by the specifier and is PENDING human review.',
  ].join('\n') + '\n';
  const result = backfillHumanApprovalText(raw);
  assert.equal(result.outcome, 'seeded');
  assert.equal(result.value, 'pending');
  assert.match(result.text, /^human_approval: pending$/m);
});

test('a comment block marking the ticket "APPROVED by operator" seeds human_approval: approved', () => {
  const raw = [
    'id: BL-901',
    'title: t',
    '',
    '# HUMAN APPROVAL: APPROVED by operator 2026-07-10 (dep now met; promotable).',
  ].join('\n') + '\n';
  const result = backfillHumanApprovalText(raw);
  assert.equal(result.outcome, 'seeded');
  assert.equal(result.value, 'approved');
});

test('the seeded field line is inserted immediately after the comment block, matching real tickets\' own layout', () => {
  const raw = 'id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: feature file\n# is pending human review.\n';
  const result = backfillHumanApprovalText(raw);
  assert.equal(result.text, 'id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: feature file\n# is pending human review.\nhuman_approval: pending\n');
});

test('a ticket that already has human_approval: is left completely untouched (idempotent, never clobbers a later human edit)', () => {
  const raw = 'id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: pending human review.\nhuman_approval: approved\n';
  const result = backfillHumanApprovalText(raw);
  assert.equal(result.outcome, 'already-set');
  assert.equal(result.text, raw);
});

test('a ticket with no "# HUMAN APPROVAL:" comment at all is left untouched (not applicable - no approval needed, or legacy)', () => {
  const raw = 'id: BL-900\ntitle: t\nstatus: paused\n';
  const result = backfillHumanApprovalText(raw);
  assert.equal(result.outcome, 'no-comment-found');
  assert.equal(result.text, raw);
});

test('a comment block whose text mentions neither "pending" nor "approved" is left undetermined, not guessed', () => {
  const raw = 'id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: this is unclear text with no verdict.\n';
  const result = backfillHumanApprovalText(raw);
  assert.equal(result.outcome, 'undetermined');
  assert.equal(result.text, raw);
});

test('matching is case-insensitive (real tickets use both "PENDING"/"pending" and "APPROVED"/"approved")', () => {
  const raw = 'id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: feature file is a new draft\n# authored by the specifier and is pending human review.\n';
  const result = backfillHumanApprovalText(raw);
  assert.equal(result.value, 'pending');
});

// ── runHumanApprovalBackfill (impure, real fs, idempotent) ────────────────

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-backfill-'));
}

function writeTicket(dir, fileName, content) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content);
}

test('seeds human_approval on both active and paused tickets carrying the legacy comment', () => {
  const targetPath = mkTmp();
  writeTicket(
    path.join(targetPath, 'backlog', 'active'),
    'BL-900.yaml',
    'id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: pending human review.\n'
  );
  writeTicket(
    path.join(targetPath, 'backlog', 'paused'),
    'BL-901.yaml',
    'id: BL-901\ntitle: t\n\n# HUMAN APPROVAL: APPROVED by operator.\n'
  );

  const results = runHumanApprovalBackfill(targetPath);

  assert.equal(results.find((r) => r.filePath.endsWith('BL-900.yaml')).outcome, 'seeded');
  assert.equal(results.find((r) => r.filePath.endsWith('BL-901.yaml')).outcome, 'seeded');
  assert.match(fs.readFileSync(path.join(targetPath, 'backlog', 'active', 'BL-900.yaml'), 'utf8'), /human_approval: pending/);
  assert.match(fs.readFileSync(path.join(targetPath, 'backlog', 'paused', 'BL-901.yaml'), 'utf8'), /human_approval: approved/);
});

test('never touches backlog/done - only active + paused are "live"', () => {
  const targetPath = mkTmp();
  const doneContentBefore = 'id: BL-902\ntitle: t\n\n# HUMAN APPROVAL: pending human review.\n';
  writeTicket(path.join(targetPath, 'backlog', 'done'), 'BL-902.yaml', doneContentBefore);

  runHumanApprovalBackfill(targetPath);

  assert.equal(fs.readFileSync(path.join(targetPath, 'backlog', 'done', 'BL-902.yaml'), 'utf8'), doneContentBefore);
});

test('running the backfill twice is a no-op the second time (idempotent) - no double-write, no clobbered value', () => {
  const targetPath = mkTmp();
  writeTicket(
    path.join(targetPath, 'backlog', 'active'),
    'BL-900.yaml',
    'id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: pending human review.\n'
  );

  runHumanApprovalBackfill(targetPath);
  const afterFirst = fs.readFileSync(path.join(targetPath, 'backlog', 'active', 'BL-900.yaml'), 'utf8');
  const secondResults = runHumanApprovalBackfill(targetPath);
  const afterSecond = fs.readFileSync(path.join(targetPath, 'backlog', 'active', 'BL-900.yaml'), 'utf8');

  assert.equal(afterFirst, afterSecond, 'the file must be byte-identical after a second run');
  assert.equal(secondResults.find((r) => r.filePath.endsWith('BL-900.yaml')).outcome, 'already-set');
});

test('a missing active or paused folder is handled gracefully, never a crash', () => {
  const targetPath = mkTmp();
  assert.doesNotThrow(() => runHumanApprovalBackfill(targetPath));
});
