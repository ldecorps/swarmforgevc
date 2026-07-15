const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isApprovalReplyText, approveHumanApprovalText, recordApprovalReply } = require('../out/concierge/pendingApprovalReply');

// BL-357: the human's reply in a ticket's own topic RECORDS the approval
// against that ticket - flipping its structured human_approval field, the
// one genuinely new writer this ticket adds (everything else reuses the
// existing NeedsApproval/topic-routing machinery).

// ── isApprovalReplyText (pure) ────────────────────────────────────────────

test('a reply containing "approve" is recognized as an approval', () => {
  assert.equal(isApprovalReplyText('approve'), true);
  assert.equal(isApprovalReplyText('Approved!'), true);
  assert.equal(isApprovalReplyText('I approve this ticket'), true);
});

test('a reply that does not mention approval is not recognized', () => {
  assert.equal(isApprovalReplyText('looks good but not yet'), false);
  assert.equal(isApprovalReplyText('what does this do?'), false);
  assert.equal(isApprovalReplyText(''), false);
});

// ── approveHumanApprovalText (pure) ───────────────────────────────────────

test('flips a pending ticket to approved', () => {
  const raw = 'id: BL-900\ntitle: t\nhuman_approval: pending\n';
  const result = approveHumanApprovalText(raw);
  assert.equal(result.changed, true);
  assert.match(result.text, /^human_approval: approved$/m);
});

// BL-408: pending-review is also flipped to approved (BL-408 fixes the
// approveHumanApprovalText regex to match both pending and pending-review).
test('flips a pending-review ticket to approved', () => {
  const raw = 'id: BL-901\ntitle: t\nhuman_approval: pending-review\n';
  const result = approveHumanApprovalText(raw);
  assert.equal(result.changed, true);
  assert.match(result.text, /^human_approval: approved$/m);
});

test('a ticket already approved is left untouched (idempotent)', () => {
  const raw = 'id: BL-900\ntitle: t\nhuman_approval: approved\n';
  const result = approveHumanApprovalText(raw);
  assert.equal(result.changed, false);
  assert.equal(result.text, raw);
});

test('a ticket with no human_approval field at all is left untouched - never invents the field', () => {
  const raw = 'id: BL-900\ntitle: t\n';
  const result = approveHumanApprovalText(raw);
  assert.equal(result.changed, false);
  assert.equal(result.text, raw);
});

test('only the human_approval line changes - every other line is preserved verbatim', () => {
  const raw = 'id: BL-900\ntitle: t\nhuman_approval: pending\nmutation_cost: medium\n';
  const result = approveHumanApprovalText(raw);
  assert.equal(result.text, 'id: BL-900\ntitle: t\nhuman_approval: approved\nmutation_cost: medium\n');
});

// ── recordApprovalReply (impure, real fs) ─────────────────────────────────

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-approval-reply-'));
}

function writeTicket(dir, fileName, content) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content);
}

test('flips a pending ACTIVE ticket found by its own id: field, not by filename', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-900-some-slug.yaml', 'id: BL-900\ntitle: t\nhuman_approval: pending\n');

  const changed = recordApprovalReply(targetPath, 'BL-900');

  assert.equal(changed, true);
  assert.match(fs.readFileSync(path.join(targetPath, 'backlog', 'active', 'BL-900-some-slug.yaml'), 'utf8'), /human_approval: approved/);
});

test('flips a pending PAUSED ticket too - a ticket can be pending while still awaiting promotion', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'paused'), 'BL-901-slug.yaml', 'id: BL-901\ntitle: t\nhuman_approval: pending\n');

  const changed = recordApprovalReply(targetPath, 'BL-901');

  assert.equal(changed, true);
  assert.match(fs.readFileSync(path.join(targetPath, 'backlog', 'paused', 'BL-901-slug.yaml'), 'utf8'), /human_approval: approved/);
});

test('a ticket already approved is left untouched and reports no change', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-902-slug.yaml', 'id: BL-902\ntitle: t\nhuman_approval: approved\n');

  const changed = recordApprovalReply(targetPath, 'BL-902');

  assert.equal(changed, false);
});

test('a backlog id with no matching ticket file is a clean no-op, never a crash', () => {
  const targetPath = mkTmp();
  const changed = recordApprovalReply(targetPath, 'BL-999');
  assert.equal(changed, false);
});

test('scans past a non-matching ticket in an earlier folder to find the match in a later one', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-904-slug.yaml', 'id: BL-904\ntitle: other\nhuman_approval: pending\n');
  writeTicket(path.join(targetPath, 'backlog', 'paused'), 'BL-905-slug.yaml', 'id: BL-905\ntitle: t\nhuman_approval: pending\n');

  const changed = recordApprovalReply(targetPath, 'BL-905');

  assert.equal(changed, true);
  assert.match(fs.readFileSync(path.join(targetPath, 'backlog', 'active', 'BL-904-slug.yaml'), 'utf8'), /human_approval: pending/);
  assert.match(fs.readFileSync(path.join(targetPath, 'backlog', 'paused', 'BL-905-slug.yaml'), 'utf8'), /human_approval: approved/);
});

test('never touches backlog/done - a completed ticket is out of scope', () => {
  const targetPath = mkTmp();
  const doneContentBefore = 'id: BL-903\ntitle: t\nhuman_approval: pending\n';
  writeTicket(path.join(targetPath, 'backlog', 'done'), 'BL-903-slug.yaml', doneContentBefore);

  const changed = recordApprovalReply(targetPath, 'BL-903');

  assert.equal(changed, false);
  assert.equal(fs.readFileSync(path.join(targetPath, 'backlog', 'done', 'BL-903-slug.yaml'), 'utf8'), doneContentBefore);
});
