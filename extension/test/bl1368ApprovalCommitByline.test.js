const assert = require('node:assert/strict');
const {
  HUMAN_DECISION_BYLINE,
  humanDecisionCommitMessage,
} = require('../out/util/commitIntegrityRunner');
const { PIPELINE_ORDER } = require('../out/metrics/swarmMetrics');
const {
  recordApprovalDecisionAndClose,
  recordAmendDecisionAndClose,
} = require('../out/tools/telegramFrontDeskBotCore');

// BL-1368: both approval entry points hardcoded `By coder.` onto the one
// commit class that records a HUMAN decision. Every agent commits as
// `t <t@t>`, so the role byline was the only attribution a reader had - and
// on this class it asserted something false, which on 2026-09-03 cost three
// roles a turn each chasing a self-flip that never happened. The remedy is
// one shared byline both writers compose from, so neither half can survive
// the other.

function namesAPipelineRole(message) {
  return PIPELINE_ORDER.some((role) => message.includes(`By ${role}.`));
}

test('the shared human-decision byline names no pipeline role', () => {
  assert.equal(namesAPipelineRole(HUMAN_DECISION_BYLINE), false);
  // Non-vacuous: the predicate DOES fire on the literal this ticket removes.
  assert.equal(namesAPipelineRole('Approve BL-1.\n\nBy coder.'), true);
});

test('humanDecisionCommitMessage keeps the subject and gives the byline its own paragraph', () => {
  const message = humanDecisionCommitMessage('Approve BL-1368: record human_approval');
  assert.equal(message, `Approve BL-1368: record human_approval\n\n${HUMAN_DECISION_BYLINE}`);
  assert.equal(namesAPipelineRole(message), false);
});

test('the byline names the decider rather than merely omitting a role', () => {
  assert.match(HUMAN_DECISION_BYLINE, /human/i);
});

function commitRecordingAdapters(extra = {}) {
  const commitCalls = [];
  return {
    adapters: {
      recordApprovalReply: async () => true,
      recordRejectionReply: async () => true,
      recordAmendReply: async () => true,
      commitApprovalWrites: async (backlogId, message) => {
        commitCalls.push({ backlogId, message });
        return true;
      },
      ...extra,
    },
    commitCalls,
  };
}

// The bot composes Approve, Reject and Amend from ONE template, so all three
// are driven here rather than Approve alone (the ticket's own e2e step 2).
const VERB_CASES = [
  ['Approve', (adapters) => recordApprovalDecisionAndClose(adapters, 'BL-1368', { kind: 'approved' }, 0)],
  ['Reject', (adapters) => recordApprovalDecisionAndClose(adapters, 'BL-1368', { kind: 'rejected', reason: 'no' }, 0)],
  ['Amend', (adapters) => recordAmendDecisionAndClose(adapters, 'BL-1368', 'steer', 0)],
];

for (const [verb, drive] of VERB_CASES) {
  test(`the bot's ${verb} decision commits with no pipeline role byline`, async () => {
    const { adapters, commitCalls } = commitRecordingAdapters();
    await drive(adapters);
    assert.equal(commitCalls.length, 1, 'the decision commits exactly once');
    assert.equal(commitCalls[0].message, humanDecisionCommitMessage(`${verb} BL-1368: record human_approval`));
    assert.equal(namesAPipelineRole(commitCalls[0].message), false);
  });
}

test("a ruling reply's commit also carries no pipeline role byline", async () => {
  const { adapters, commitCalls } = commitRecordingAdapters({
    recordRulingReply: async () => true,
  });
  const { recordRulingDecisionAndClose } = require('../out/tools/telegramFrontDeskBotCore');
  await recordRulingDecisionAndClose(adapters, 'BL-1368', 'option 2', 0);
  assert.equal(commitCalls.length, 1);
  assert.equal(namesAPipelineRole(commitCalls[0].message), false);
});
