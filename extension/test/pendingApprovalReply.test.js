const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  isApprovalReplyText,
  approveHumanApprovalText,
  rulingHumanApprovalText,
  recordApprovalReply,
  recordRulingReply,
  readRecordedRuling,
  readRulingOptions,
  classifyApprovalReplyAction,
  rejectHumanApprovalText,
  recordRejectionReply,
  amendHumanApprovalText,
  recordAmendReply,
  isTicketPendingApproval,
  classifyApprovalsTopicReply,
  readRecordedVerdict,
  readApprovalCloseVerdict,
  classifyApprovalRecordNoOp,
  explainApprovalRecordNoOp,
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

test('BL-589: rulingHumanApprovalText approves and records human_ruling', () => {
  const raw = 'id: BL-589\ntitle: t\nhuman_approval: pending\n';
  const result = rulingHumanApprovalText(raw, 'approach one');
  assert.equal(result.changed, true);
  assert.match(result.text, /human_approval: approved/);
  assert.match(result.text, /human_ruling: \|\n  approach one/);
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

// ── classifyApprovalsTopicReply (pure) - BL-434 ────────────────────────────
// The standing Approvals topic's own reply grammar: a reply must NAME the
// ticket it acts on, since one topic now carries many tickets.

test('BL-434: "approve <id>" is classified as approve for that exact ticket id', () => {
  assert.deepEqual(classifyApprovalsTopicReply('approve BL-433'), { kind: 'approve', backlogId: 'BL-433' });
});

test('BL-434: "reject <id> <reason>" is classified as reject for that exact ticket id, capturing the reason', () => {
  assert.deepEqual(classifyApprovalsTopicReply('reject BL-433 no good'), { kind: 'reject', backlogId: 'BL-433', reason: 'no good' });
});

test('BL-434: a bare "approve" with no id classifies as none - the Approvals topic grammar requires an id', () => {
  assert.deepEqual(classifyApprovalsTopicReply('approve'), { kind: 'none' });
});

test('BL-434: a bare "reject <id>" with no reason still classifies as reject, with an empty reason', () => {
  assert.deepEqual(classifyApprovalsTopicReply('reject BL-433'), { kind: 'reject', backlogId: 'BL-433', reason: '' });
});

test('BL-434: an ordinary reply naming neither verb classifies as none', () => {
  assert.deepEqual(classifyApprovalsTopicReply('still working on it'), { kind: 'none' });
  assert.deepEqual(classifyApprovalsTopicReply(''), { kind: 'none' });
});

test('BL-434: reject wins over an "approve" substring appearing inside its own reason (priority-order regression guard)', () => {
  assert.deepEqual(classifyApprovalsTopicReply('reject BL-433 needs a second approve from ops'), {
    kind: 'reject',
    backlogId: 'BL-433',
    reason: 'needs a second approve from ops',
  });
});

test('BL-434: classification trims surrounding whitespace before matching and after capturing', () => {
  assert.deepEqual(classifyApprovalsTopicReply('  reject   BL-433   no good  '), { kind: 'reject', backlogId: 'BL-433', reason: 'no good' });
  assert.deepEqual(classifyApprovalsTopicReply('  approve   BL-433  '), { kind: 'approve', backlogId: 'BL-433' });
});

// BL-721: "/qjump <id>" - a typed alternative to tapping the Approvals ask's
// Q jump button, same verb+id grammar as approve/reject above.

test('BL-721: "/qjump <id>" is classified as qjump for that exact ticket id', () => {
  assert.deepEqual(classifyApprovalsTopicReply('/qjump BL-433'), { kind: 'qjump', backlogId: 'BL-433' });
});

test('BL-721: "/qjump" classification is case-insensitive on the verb', () => {
  assert.deepEqual(classifyApprovalsTopicReply('/QJump BL-433'), { kind: 'qjump', backlogId: 'BL-433' });
});

test('BL-721: a bare "/qjump" with no id classifies as none - the grammar requires an id', () => {
  assert.deepEqual(classifyApprovalsTopicReply('/qjump'), { kind: 'none' });
});

test('BL-721: "qjump <id>" with no leading slash classifies as none - the slash prefix is required', () => {
  assert.deepEqual(classifyApprovalsTopicReply('qjump BL-433'), { kind: 'none' });
});

test('BL-721: "/qjump <id>" classification trims surrounding whitespace', () => {
  assert.deepEqual(classifyApprovalsTopicReply('  /qjump   BL-433  '), { kind: 'qjump', backlogId: 'BL-433' });
});

test('BL-721: "/expedite <id>" (the offline Cursor-bridge verb) is never classified as qjump - queue-jump and the offline expeditor are distinct commands', () => {
  assert.deepEqual(classifyApprovalsTopicReply('/expedite BL-433'), { kind: 'none' });
});

// BL-893: "/ambulance <id>" — typed twin of the Approvals Ambulance button.

test('BL-893: "/ambulance <id>" is classified as ambulance for that exact ticket id', () => {
  assert.deepEqual(classifyApprovalsTopicReply('/ambulance BL-893'), { kind: 'ambulance', backlogId: 'BL-893' });
});

test('BL-893: "/ambulance" classification is case-insensitive on the verb', () => {
  assert.deepEqual(classifyApprovalsTopicReply('/Ambulance BL-893'), { kind: 'ambulance', backlogId: 'BL-893' });
});

test('BL-893: a bare "/ambulance" with no id classifies as none', () => {
  assert.deepEqual(classifyApprovalsTopicReply('/ambulance'), { kind: 'none' });
});

test('BL-893: "/ambulance <id>" is never classified as qjump', () => {
  assert.notEqual(classifyApprovalsTopicReply('/ambulance BL-893').kind, 'qjump');
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

// BL-409 QA bounce (2026-07-15): a multi-line reason (an ordinary Telegram
// reply typed across more than one line - a human pressing Enter
// mid-thought, not a crafted attack) must not inject new YAML lines/keys
// into the ticket file. Reproduces the QA-reported failing command:
// classifyApprovalReplyAction's REJECT_PATTERN deliberately captures across
// newlines, so the raw reason arriving at rejectHumanApprovalText already
// contains embedded `\n` - this is the sink that must sanitize it.
test('a multi-line reject reason is collapsed to a single line - no injected human_approval override or extra key (BL-409 bounce)', () => {
  const raw = 'id: BL-999\ntitle: t\nhuman_approval: pending\nmutation_cost: medium\n';
  const action = classifyApprovalReplyAction('reject bad scope\nhuman_approval: approved\nmalicious: true');
  assert.deepEqual(action, { kind: 'reject', reason: 'bad scope\nhuman_approval: approved\nmalicious: true' });

  const result = rejectHumanApprovalText(raw, action.reason);
  const lines = result.text.split('\n');

  assert.equal(result.changed, true);
  assert.equal(
    lines.filter((l) => l.startsWith('human_approval:')).length,
    1,
    'exactly one human_approval line must survive - a multi-line reason must not add a second one'
  );
  assert.ok(!lines.includes('malicious: true'), 'the reason must never become a standalone injected YAML key');
  assert.equal(
    result.text,
    'id: BL-999\ntitle: t\nhuman_approval: rejected  # bad scope human_approval: approved malicious: true\nmutation_cost: medium\n'
  );
});

test('rejectHumanApprovalText collapses \\r\\n and bare \\r the same way as \\n', () => {
  const raw = 'id: BL-914\ntitle: t\nhuman_approval: pending\n';
  const result = rejectHumanApprovalText(raw, 'first line\r\nsecond line\rthird line');
  assert.match(result.text, /^human_approval: rejected {2}# first line second line third line$/m);
});

test('rejectHumanApprovalText trims leading/trailing whitespace left behind by a leading/trailing newline', () => {
  const raw = 'id: BL-915\ntitle: t\nhuman_approval: pending\n';
  const result = rejectHumanApprovalText(raw, '\nbad scope\n');
  assert.match(result.text, /^human_approval: rejected {2}# bad scope$/m);
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

// ── amendHumanApprovalText (pure) - BL-509 ─────────────────────────────────

test('flips a pending ticket to amending', () => {
  const raw = 'id: BL-950\ntitle: t\nhuman_approval: pending\n';
  const result = amendHumanApprovalText(raw);
  assert.equal(result.changed, true);
  assert.match(result.text, /^human_approval: amending$/m);
});

test('flips a pending-review ticket to amending too', () => {
  const raw = 'id: BL-951\ntitle: t\nhuman_approval: pending-review\n';
  const result = amendHumanApprovalText(raw);
  assert.equal(result.changed, true);
  assert.match(result.text, /^human_approval: amending$/m);
});

test('a ticket already approved is left untouched by amend (never overwrites a resolved ticket)', () => {
  const raw = 'id: BL-952\ntitle: t\nhuman_approval: approved\n';
  const result = amendHumanApprovalText(raw);
  assert.equal(result.changed, false);
  assert.equal(result.text, raw);
});

test('a ticket already amending is left untouched by a second amend (idempotent)', () => {
  const raw = 'id: BL-953\ntitle: t\nhuman_approval: amending\n';
  const result = amendHumanApprovalText(raw);
  assert.equal(result.changed, false);
  assert.equal(result.text, raw);
});

test('amendHumanApprovalText only changes the human_approval line - every other line is preserved verbatim', () => {
  const raw = 'id: BL-954\ntitle: t\nhuman_approval: pending\nmutation_cost: medium\n';
  const result = amendHumanApprovalText(raw);
  assert.equal(result.text, 'id: BL-954\ntitle: t\nhuman_approval: amending\nmutation_cost: medium\n');
});

// ── recordAmendReply (impure, real fs) - BL-509 ────────────────────────────

test('flips a pending ticket to amending by its own id: field', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-960-some-slug.yaml', 'id: BL-960\ntitle: t\nhuman_approval: pending\n');

  const changed = recordAmendReply(targetPath, 'BL-960');

  assert.equal(changed, true);
  assert.match(fs.readFileSync(path.join(targetPath, 'backlog', 'active', 'BL-960-some-slug.yaml'), 'utf8'), /human_approval: amending/);
});

test('flips a pending PAUSED ticket to amending too', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'paused'), 'BL-961-slug.yaml', 'id: BL-961\ntitle: t\nhuman_approval: pending\n');

  const changed = recordAmendReply(targetPath, 'BL-961');

  assert.equal(changed, true);
  assert.match(fs.readFileSync(path.join(targetPath, 'backlog', 'paused', 'BL-961-slug.yaml'), 'utf8'), /human_approval: amending/);
});

test('an already-amending ticket is left untouched and reports no change (idempotent)', () => {
  const targetPath = mkTmp();
  const before = 'id: BL-962\ntitle: t\nhuman_approval: amending\n';
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-962-slug.yaml', before);

  const changed = recordAmendReply(targetPath, 'BL-962');

  assert.equal(changed, false);
  assert.equal(fs.readFileSync(path.join(targetPath, 'backlog', 'active', 'BL-962-slug.yaml'), 'utf8'), before);
});

test('a backlog id with no matching ticket file is a clean no-op for amend too', () => {
  const targetPath = mkTmp();
  const changed = recordAmendReply(targetPath, 'BL-999');
  assert.equal(changed, false);
});

// ── isTicketPendingApproval (read-only, real fs) - BL-416 ─────────────────

test('a ticket with human_approval: pending is reported pending', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-930-slug.yaml', 'id: BL-930\ntitle: t\nhuman_approval: pending\n');
  assert.equal(isTicketPendingApproval(targetPath, 'BL-930'), true);
});

test('a ticket with human_approval: pending-review is reported pending too', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'paused'), 'BL-931-slug.yaml', 'id: BL-931\ntitle: t\nhuman_approval: pending-review\n');
  assert.equal(isTicketPendingApproval(targetPath, 'BL-931'), true);
});

test('an approved ticket is reported not pending', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-932-slug.yaml', 'id: BL-932\ntitle: t\nhuman_approval: approved\n');
  assert.equal(isTicketPendingApproval(targetPath, 'BL-932'), false);
});

test('a ticket with no human_approval field at all is reported not pending', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-933-slug.yaml', 'id: BL-933\ntitle: t\n');
  assert.equal(isTicketPendingApproval(targetPath, 'BL-933'), false);
});

test('a backlog id with no matching ticket file at all is reported not pending, never a crash', () => {
  const targetPath = mkTmp();
  assert.equal(isTicketPendingApproval(targetPath, 'BL-999'), false);
});

// BL-416 scenario 03: the pending determination is scoped to THIS ticket's
// own id, not a global/first-match answer - a pending ticket and a
// not-pending ticket coexisting in the same fixture must each report their
// own state independently.
test('pending determination is scoped per-ticket - a pending ticket and a non-pending ticket in the same fixture each report their own state', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-934-slug.yaml', 'id: BL-934\ntitle: t\nhuman_approval: pending\n');
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-935-slug.yaml', 'id: BL-935\ntitle: t\nhuman_approval: approved\n');

  assert.equal(isTicketPendingApproval(targetPath, 'BL-934'), true);
  assert.equal(isTicketPendingApproval(targetPath, 'BL-935'), false);
});

// ── readRecordedVerdict (read-only, real fs) - BL-484 ─────────────────────
// The stale-tap guard needs the SPECIFIC recorded verdict (not just
// isTicketPendingApproval's plain pending/not-pending) to name it in the
// "already decided: <verdict>" toast.

test('an approved ticket reports the approved verdict', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-940-slug.yaml', 'id: BL-940\ntitle: t\nhuman_approval: approved\n');
  assert.equal(readRecordedVerdict(targetPath, 'BL-940'), 'approved');
});

test('a rejected ticket reports the rejected verdict, reason comment and all', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-941-slug.yaml', 'id: BL-941\ntitle: t\nhuman_approval: rejected  # bad scope\n');
  assert.equal(readRecordedVerdict(targetPath, 'BL-941'), 'rejected');
});

test('a still-pending ticket reports no recorded verdict', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-942-slug.yaml', 'id: BL-942\ntitle: t\nhuman_approval: pending\n');
  assert.equal(readRecordedVerdict(targetPath, 'BL-942'), undefined);
});

test('a ticket with no human_approval field at all reports no recorded verdict', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-943-slug.yaml', 'id: BL-943\ntitle: t\n');
  assert.equal(readRecordedVerdict(targetPath, 'BL-943'), undefined);
});

// BL-509: 'amending' is deliberately NOT a terminal verdict for the
// stale-tap guard's purposes - unlike approved/rejected, the specifier
// flips it back to pending (slice 3), so a ticket legitimately cycles
// through this state more than once. readRecordedVerdict's own pattern
// stays scoped to approved|rejected; widening it is out of this slice's
// scope (no scenario in the live feature exercises a stale re-tap on an
// amending ticket).
test('an amending ticket reports no recorded verdict (amending is not a stale-tap-guard terminal state)', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-944-slug.yaml', 'id: BL-944\ntitle: t\nhuman_approval: amending\n');
  assert.equal(readRecordedVerdict(targetPath, 'BL-944'), undefined);
});

test('a backlog id with no matching ticket file reports no recorded verdict, never a crash', () => {
  const targetPath = mkTmp();
  assert.equal(readRecordedVerdict(targetPath, 'BL-999'), undefined);
});

// ── readApprovalCloseVerdict (read-only, real fs) - BL-561 ────────────────

test('readApprovalCloseVerdict: approved ticket yields approved verdict', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'paused'), 'BL-950.yaml', 'id: BL-950\ntitle: t\nhuman_approval: approved\n');
  assert.deepEqual(readApprovalCloseVerdict(targetPath, 'BL-950'), { kind: 'approved' });
});

test('readApprovalCloseVerdict: rejected ticket yields rejected verdict with reason', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'paused'), 'BL-951.yaml', 'id: BL-951\ntitle: t\nhuman_approval: rejected # bad scope\n');
  assert.deepEqual(readApprovalCloseVerdict(targetPath, 'BL-951'), { kind: 'rejected', reason: 'bad scope' });
});

test('readApprovalCloseVerdict: amending ticket yields amending verdict', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'paused'), 'BL-952.yaml', 'id: BL-952\ntitle: t\nhuman_approval: amending\n');
  assert.deepEqual(readApprovalCloseVerdict(targetPath, 'BL-952'), { kind: 'amending' });
});

test('readApprovalCloseVerdict: still-pending ticket yields undefined', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'paused'), 'BL-953.yaml', 'id: BL-953\ntitle: t\nhuman_approval: pending\n');
  assert.equal(readApprovalCloseVerdict(targetPath, 'BL-953'), undefined);
});


// ── BL-582: WHY a record changed nothing ─────────────────────────────────
//    recordApprovalReply returns a bare boolean, so the tap that failed on
//    2026-07-23 had nothing to say even to a listener. Every no-op now
//    classifies into a reason a human can act on.

test('BL-582: classifyApprovalRecordNoOp distinguishes each already-resolved verdict', () => {
  assert.equal(classifyApprovalRecordNoOp('id: BL-1\nhuman_approval: approved\n'), 'already-approved');
  assert.equal(classifyApprovalRecordNoOp('id: BL-1\nhuman_approval: rejected # too big\n'), 'already-rejected');
  assert.equal(classifyApprovalRecordNoOp('id: BL-1\nhuman_approval: amending\n'), 'already-amending');
});

test('BL-582: classifyApprovalRecordNoOp reports a missing field as its own case, never as a verdict', () => {
  assert.equal(classifyApprovalRecordNoOp('id: BL-1\ntitle: t\n'), 'no-human-approval-field');
});

test('BL-582: classifyApprovalRecordNoOp reports an unrecognized value rather than mislabelling it as decided', () => {
  assert.equal(classifyApprovalRecordNoOp('id: BL-1\nhuman_approval: pending\n'), 'human-approval-not-pending');
  assert.equal(classifyApprovalRecordNoOp('id: BL-1\nhuman_approval: whatever\n'), 'human-approval-not-pending');
});

test('BL-582: explainApprovalRecordNoOp names a missing ticket file - the stale-topic-mapping case', () => {
  const targetPath = mkTmp();
  assert.equal(explainApprovalRecordNoOp(targetPath, 'BL-999'), 'no-ticket-file');
});

test('BL-582: explainApprovalRecordNoOp reads the real ticket, wherever it lives', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'paused'), 'BL-582-slug.yaml', 'id: BL-582\ntitle: t\nhuman_approval: approved\n');

  assert.equal(explainApprovalRecordNoOp(targetPath, 'BL-582'), 'already-approved');
});

// ── BL-1367: an approval from any surface carries its ruling ───────────────
//
// Two surfaces could record an approval and only one could record a ruling.
// The bot's callback path reaches recordRulingReply; the paused-pager Mini App
// called recordApprovalReply(targetPath, backlogId) - a signature with no
// ruling parameter - so an approval tapped on the phone flipped
// human_approval and silently discarded the answer, for any ticket, however
// many options it declared. BL-1309 was approved that way on 2026-09-01, its
// binary question never answered, and the coder built on its own reading.
//
// The seam is the signature: one writer both entry points reach, so a third
// surface cannot reintroduce this by having its own.

const {
  classifyApprovalRulingRequirement,
} = require('../out/concierge/pendingApprovalReply');

test('BL-1367: a ticket declaring no ruling options approves as before', () => {
  assert.deepEqual(classifyApprovalRulingRequirement(undefined, undefined), { kind: 'ok' });
  assert.deepEqual(classifyApprovalRulingRequirement([], undefined), { kind: 'ok' });
});

test('BL-1367: a ticket declaring options refuses a bare approval rather than half-recording it', () => {
  const options = ['do it in code', 'do it by rule'];
  assert.deepEqual(classifyApprovalRulingRequirement(options, undefined), {
    kind: 'ruling-required',
    options,
  });
  // Blank is not an answer either - a surface that sent an empty field must
  // not slip past the check a missing one trips.
  assert.equal(classifyApprovalRulingRequirement(options, '   ').kind, 'ruling-required');
});

test('BL-1367: a ruling that names a declared option is accepted', () => {
  const options = ['do it in code', 'do it by rule'];
  assert.deepEqual(classifyApprovalRulingRequirement(options, 'do it by rule'), { kind: 'ok' });
  // Surrounding whitespace is a transport artefact, not a different answer.
  assert.deepEqual(classifyApprovalRulingRequirement(options, '  do it by rule  '), { kind: 'ok' });
});

test('BL-1367: a ruling that names no declared option is refused, never recorded', () => {
  const options = ['do it in code', 'do it by rule'];
  const verdict = classifyApprovalRulingRequirement(options, 'do it some third way');
  assert.equal(verdict.kind, 'unknown-option');
  assert.deepEqual(verdict.options, options);
});

test('BL-1367: a ruling offered for a ticket that poses no choice is refused, not silently written', () => {
  // Nothing declared it, so nothing can validate it - and a human_ruling on a
  // ticket with no options is exactly the unanswerable state this ticket
  // exists to prevent, in the other direction.
  assert.equal(classifyApprovalRulingRequirement(undefined, 'some option').kind, 'unknown-option');
  assert.equal(classifyApprovalRulingRequirement([], 'some option').kind, 'unknown-option');
});

test('BL-1367: recordApprovalReply records the ruling when one is given', () => {
  const dir = mkTmpDir('bl1367-record-');
  try {
    const activeDir = path.join(dir, 'backlog', 'active');
    fs.mkdirSync(activeDir, { recursive: true });
    fs.writeFileSync(
      path.join(activeDir, 'BL-9367.yaml'),
      'id: BL-9367\ntitle: poses a choice\nhuman_approval: pending\nruling_options:\n  - do it in code\n  - do it by rule\n'
    );
    assert.equal(recordApprovalReply(dir, 'BL-9367', 'do it by rule'), true);
    const yaml = fs.readFileSync(path.join(activeDir, 'BL-9367.yaml'), 'utf8');
    assert.match(yaml, /^human_approval: approved$/m);
    assert.match(yaml, /^human_ruling: \|\n {2}do it by rule$/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-1367: recordApprovalReply with no ruling is byte-for-byte what it always was', () => {
  const dir = mkTmpDir('bl1367-plain-');
  try {
    const activeDir = path.join(dir, 'backlog', 'active');
    fs.mkdirSync(activeDir, { recursive: true });
    fs.writeFileSync(
      path.join(activeDir, 'BL-9368.yaml'),
      'id: BL-9368\ntitle: poses no choice\nhuman_approval: pending\n'
    );
    assert.equal(recordApprovalReply(dir, 'BL-9368'), true);
    const yaml = fs.readFileSync(path.join(activeDir, 'BL-9368.yaml'), 'utf8');
    assert.match(yaml, /^human_approval: approved$/m);
    assert.equal(/human_ruling/.test(yaml), false, 'a ticket posing no choice must gain no ruling');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-1367 invariant 2: an existing ruling survives a later plain approval', () => {
  const dir = mkTmpDir('bl1367-keep-');
  try {
    const activeDir = path.join(dir, 'backlog', 'active');
    fs.mkdirSync(activeDir, { recursive: true });
    // The live shape this guards: BL-1296 was re-pended AFTER a ruling existed.
    const before =
      'id: BL-9369\ntitle: re-pended after a ruling\nhuman_approval: pending\nhuman_ruling: |\n  the answer already given\n';
    fs.writeFileSync(path.join(activeDir, 'BL-9369.yaml'), before);
    assert.equal(recordApprovalReply(dir, 'BL-9369'), true);
    const yaml = fs.readFileSync(path.join(activeDir, 'BL-9369.yaml'), 'utf8');
    assert.match(yaml, /^human_approval: approved$/m);
    assert.match(yaml, /^human_ruling: \|\n {2}the answer already given$/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
