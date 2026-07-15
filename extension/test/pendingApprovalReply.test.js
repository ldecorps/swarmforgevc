const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  isApprovalReplyText,
  approveHumanApprovalText,
  recordApprovalReply,
  classifyApprovalReplyAction,
  rejectHumanApprovalText,
  recordRejectionReply,
} = require('../out/concierge/pendingApprovalReply');

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
  return mkTmpDir('sfvc-approval-reply-');
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

// ── classifyApprovalReplyAction (pure) - BL-409 ────────────────────────────

test('a reply starting with "reject " is classified as reject, capturing the reason', () => {
  assert.deepEqual(classifyApprovalReplyAction('reject bad scope'), { kind: 'reject', reason: 'bad scope' });
});

test('a reply starting with "amend " is classified as amend, capturing the note', () => {
  assert.deepEqual(classifyApprovalReplyAction('amend tighten the acceptance criteria'), {
    kind: 'amend',
    note: 'tighten the acceptance criteria',
  });
});

test('a plain approve reply is still classified as approve (regression guard)', () => {
  assert.deepEqual(classifyApprovalReplyAction('approve'), { kind: 'approve' });
  assert.deepEqual(classifyApprovalReplyAction('I approve this ticket'), { kind: 'approve' });
});

test('an ordinary reply with none of the three verbs classifies as none', () => {
  assert.deepEqual(classifyApprovalReplyAction('still working on it'), { kind: 'none' });
  assert.deepEqual(classifyApprovalReplyAction(''), { kind: 'none' });
});

// BL-409/engineering.prompt ordered-dispatch rule: reject/amend are anchored
// verb PREFIXES, checked before the unanchored "approve" substring match -
// a reject/amend reply whose own reason/note happens to contain the text
// "approve" must still classify as reject/amend, not approve. Both
// conditions hold simultaneously here, so this pins the priority order a
// per-branch-only test cannot.
test('reject wins over an "approve" substring appearing inside its own reason', () => {
  assert.deepEqual(classifyApprovalReplyAction('reject needs a second approve from ops'), {
    kind: 'reject',
    reason: 'needs a second approve from ops',
  });
});

test('amend wins over an "approve" substring appearing inside its own note', () => {
  assert.deepEqual(classifyApprovalReplyAction('amend get final approve from ops first'), {
    kind: 'amend',
    note: 'get final approve from ops first',
  });
});

test('classification trims surrounding whitespace before matching and after capturing', () => {
  assert.deepEqual(classifyApprovalReplyAction('  reject   bad scope  '), { kind: 'reject', reason: 'bad scope' });
});

test('"reject" or "amend" with no payload text does not match the verb form (falls through)', () => {
  assert.deepEqual(classifyApprovalReplyAction('reject'), { kind: 'none' });
  assert.deepEqual(classifyApprovalReplyAction('amend'), { kind: 'none' });
});

// ── rejectHumanApprovalText (pure) - BL-409 ────────────────────────────────

test('flips a pending ticket to rejected, recording the reason as a trailing comment', () => {
  const raw = 'id: BL-910\ntitle: t\nhuman_approval: pending\n';
  const result = rejectHumanApprovalText(raw, 'bad scope');
  assert.equal(result.changed, true);
  assert.match(result.text, /^human_approval: rejected {2}# bad scope$/m);
});

test('flips a pending-review ticket to rejected too', () => {
  const raw = 'id: BL-911\ntitle: t\nhuman_approval: pending-review\n';
  const result = rejectHumanApprovalText(raw, 'bad scope');
  assert.equal(result.changed, true);
  assert.match(result.text, /^human_approval: rejected {2}# bad scope$/m);
});

test('a ticket already approved is left untouched by reject (never overwrites a resolved ticket)', () => {
  const raw = 'id: BL-912\ntitle: t\nhuman_approval: approved\n';
  const result = rejectHumanApprovalText(raw, 'bad scope');
  assert.equal(result.changed, false);
  assert.equal(result.text, raw);
});

test('rejectHumanApprovalText only changes the human_approval line - every other line is preserved verbatim', () => {
  const raw = 'id: BL-913\ntitle: t\nhuman_approval: pending\nmutation_cost: medium\n';
  const result = rejectHumanApprovalText(raw, 'bad scope');
  assert.equal(result.text, 'id: BL-913\ntitle: t\nhuman_approval: rejected  # bad scope\nmutation_cost: medium\n');
});

// ── recordRejectionReply (impure, real fs) - BL-409 ────────────────────────

test('flips a pending ticket to rejected by its own id: field, recording the reason', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-920-some-slug.yaml', 'id: BL-920\ntitle: t\nhuman_approval: pending\n');

  const changed = recordRejectionReply(targetPath, 'BL-920', 'bad scope');

  assert.equal(changed, true);
  assert.match(
    fs.readFileSync(path.join(targetPath, 'backlog', 'active', 'BL-920-some-slug.yaml'), 'utf8'),
    /human_approval: rejected {2}# bad scope/
  );
});

test('a rejected-already ticket is left untouched and reports no change (idempotent)', () => {
  const targetPath = mkTmp();
  const before = 'id: BL-921\ntitle: t\nhuman_approval: rejected  # already rejected once\n';
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-921-slug.yaml', before);

  const changed = recordRejectionReply(targetPath, 'BL-921', 'bad scope again');

  assert.equal(changed, false);
  assert.equal(fs.readFileSync(path.join(targetPath, 'backlog', 'active', 'BL-921-slug.yaml'), 'utf8'), before);
});

test('a backlog id with no matching ticket file is a clean no-op for reject too', () => {
  const targetPath = mkTmp();
  const changed = recordRejectionReply(targetPath, 'BL-999', 'bad scope');
  assert.equal(changed, false);
});
