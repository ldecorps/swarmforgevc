const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  pollAndForward,
  decideSteeringAction,
  APPROVALS_SUBJECT_ID,
  RECERT_SUBJECT_ID,
} = require('../out/tools/telegramFrontDeskBotCore');
const { decideNegotiationUpdateAction } = require('../out/onboarding/negotiationTelegramRouting');
const { processNegotiationUpdate } = require('../out/onboarding/negotiationTelegramRelay');

// BL-955 declared invariants (backlog/active/BL-955-annotate-caption-derived-text-on-every-forwarding-surface.yaml):
// 1. No caption-derived text reaches a reader or a durable record without
//    the image-not-read note - including any forwarding surface added
//    after this ticket.
// 2. The note is appended at forwarding/record time only, never to text a
//    decision or a command parser will read.
// Coder-authored property tests per BL-654; runs only via npm run test:properties.
//
// Invariant 1's "any forwarding surface added after this ticket" clause
// quantifies over FUTURE code and admits no executable encoding - what IS
// encoded is its whole present extension: all six live forwarding
// surfaces, each driven end-to-end, photo and plain both by construction.
// Invariant 2 is encoded as decision/parse equality: the classification a
// decision function reaches for a photo caption equals the one it reaches
// for the identical plain text, and a control command sent as a caption
// executes exactly as typed.
//
// Non-vacuity proven by hand at authoring time: annotating
// decideNegotiationUpdateAction's objection text at DECISION time (inside
// the decide) fails invariant 2's classification-equality property when
// the caption is itself an agreement word away from reclassifying;
// concretely verified by removing the steering boundary's
// annotateRoutedMediaText call, which fails invariant 1's steering rows
// immediately. Both restored.

const PRINCIPAL_ID = 111;
const NOTE = '[image attached - not read by the front desk]';

// Safe word alphabet BY CONSTRUCTION: tokens that no surface's own parser
// or classifier claims (never "agree"/"yes", never a bare command verb).
const wordsArb = fc
  .array(fc.constantFrom('widget', 'edge', 'case7', 'variant', 'scope', 'blue', 'tighten'), { minLength: 1, maxLength: 5 })
  .map((ws) => ws.join(' '));

function mkTextUpdate({ topicId, text }) {
  return { update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: topicId, text } };
}

function mkPhotoUpdate({ topicId, caption }) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: 1 },
      from: { id: PRINCIPAL_ID },
      message_thread_id: topicId,
      photo: [{ file_id: 'photo-1', width: 90, height: 60 }],
      caption,
    },
  };
}

function mkUpdateFor({ topicId, words, isPhoto, prefix = '' }) {
  const body = `${prefix}${words}`;
  return isPhoto ? mkPhotoUpdate({ topicId, caption: body }) : mkTextUpdate({ topicId, text: body });
}

const baseAdapters = (captured) => ({
  chatId: '1',
  postToBridge: async () => true,
  subjectForTopic: () => undefined,
  backlogForTopic: () => undefined,
  openSubjectAndRecord: async () => 'SUP-9',
  captured,
});

// Each surface drives the REAL pollAndForward (or the negotiation relay)
// and returns the text that actually left the front desk.
const SURFACES = {
  steering: async (words, isPhoto) => {
    const captured = [];
    await pollAndForward(0, PRINCIPAL_ID, {
      ...baseAdapters(captured),
      getUpdates: async () => ({ success: true, updates: [mkUpdateFor({ topicId: 42, words, isPhoto })] }),
      readRoleTopicMap: () => ({ coder: 42 }),
      redirectToRole: async (_role, text) => {
        captured.push(text);
        return { kind: 'delivered' };
      },
    });
    return { forwarded: captured, expectedBody: words };
  },
  'agent-questions': async (words, isPhoto) => {
    const captured = [];
    await pollAndForward(0, PRINCIPAL_ID, {
      ...baseAdapters(captured),
      getUpdates: async () => ({ success: true, updates: [mkUpdateFor({ topicId: 42, words, isPhoto })] }),
      agentQuestionsTopicId: async () => 42,
      getPendingAgentQuestionThread: async () => 'SUP-1',
      postToBridge: async (_subjectId, text) => {
        captured.push(text);
        return true;
      },
    });
    return { forwarded: captured, expectedBody: words };
  },
  onboarding: async (words, isPhoto) => {
    const captured = [];
    await pollAndForward(0, PRINCIPAL_ID, {
      ...baseAdapters(captured),
      getUpdates: async () => ({ success: true, updates: [mkUpdateFor({ topicId: 42, words, isPhoto })] }),
      onboardingTopicId: async () => 42,
      handleOnboarderMessage: async (_topicId, text) => {
        captured.push(text);
        return true;
      },
    });
    return { forwarded: captured, expectedBody: words };
  },
  'negotiation-relay': async (words, isPhoto) => {
    const captured = [];
    await processNegotiationUpdate(mkUpdateFor({ topicId: 42, words, isPhoto }), String(PRINCIPAL_ID), '1', 42, {
      objectToContract: async (text) => {
        captured.push(text);
        return { outcome: 'revised', contract: { scope: [], outOfScope: [], boundaries: [], initialBacklogSummary: '', agreement: 'proposed' } };
      },
      approveContract: async () => {
        throw new Error('generated words must never classify as agreement');
      },
      postToTopic: async () => {},
    });
    return { forwarded: captured, expectedBody: words };
  },
  'approvals-reject-reason': async (words, isPhoto) => {
    const captured = [];
    await pollAndForward(0, PRINCIPAL_ID, {
      ...baseAdapters(captured),
      getUpdates: async () => ({
        success: true,
        updates: [mkUpdateFor({ topicId: 750, words, isPhoto, prefix: 'reject BL-433 ' })],
      }),
      subjectForTopic: (topicId) => (topicId === 750 ? APPROVALS_SUBJECT_ID : undefined),
      recordRejectionReply: async (_backlogId, reason) => {
        captured.push(reason);
        return true;
      },
    });
    return { forwarded: captured, expectedBody: words };
  },
  'recert-amend-text': async (words, isPhoto) => {
    const captured = [];
    await pollAndForward(0, PRINCIPAL_ID, {
      ...baseAdapters(captured),
      getUpdates: async () => ({
        success: true,
        updates: [mkUpdateFor({ topicId: 900, words, isPhoto, prefix: 'amend BL-207-thing-01 ' })],
      }),
      subjectForTopic: (topicId) => (topicId === 900 ? RECERT_SUBJECT_ID : undefined),
      queueRecertAmendProposal: async (_scenarioId, newText) => {
        captured.push(newText);
        return true;
      },
    });
    return { forwarded: captured, expectedBody: words };
  },
};

// ── Invariant 1: every live surface, note iff a photo rode along ──────────

test('BL-955 invariant 1: each forwarding surface passes caption text on WITH the note, and plain text byte-identical', { timeout: 120000 }, async () => {
  const surfaceSeen = Object.fromEntries(Object.keys(SURFACES).map((k) => [k, 0]));
  let photoSeen = 0;
  await fc.assert(
    fc.asyncProperty(fc.constantFrom(...Object.keys(SURFACES)), wordsArb, fc.boolean(), async (surface, words, isPhoto) => {
      const { forwarded, expectedBody } = await SURFACES[surface](words, isPhoto);
      assert.equal(forwarded.length, 1, `${surface}: expected exactly one forward`);
      const expected = isPhoto ? `${expectedBody}\n${NOTE}` : expectedBody;
      assert.equal(forwarded[0], expected, `${surface} (photo=${isPhoto})`);
      surfaceSeen[surface] += 1;
      if (isPhoto) photoSeen += 1;
    }),
    { numRuns: 120 }
  );
  // asserted reachability floors, never hoped-for
  for (const [surface, count] of Object.entries(surfaceSeen)) {
    assert.ok(count >= 8, `surface ${surface} exercised only ${count} times`);
  }
  assert.ok(photoSeen >= 30, `only ${photoSeen} photo runs`);
});

// ── Invariant 2: the note never reaches decision or parser text ───────────

test('BL-955 invariant 2: a decision classifies a photo caption exactly as the identical plain text', () => {
  fc.assert(
    fc.property(wordsArb, (words) => {
      const steerPhoto = decideSteeringAction(mkPhotoUpdate({ topicId: 42, caption: words }), PRINCIPAL_ID, '1', { coder: 42 });
      const steerPlain = decideSteeringAction(mkTextUpdate({ topicId: 42, text: words }), PRINCIPAL_ID, '1', { coder: 42 });
      assert.deepEqual(steerPhoto, steerPlain, 'steering decision must not see the note');
      const negPhoto = decideNegotiationUpdateAction(mkPhotoUpdate({ topicId: 42, caption: words }), String(PRINCIPAL_ID), '1', 42);
      const negPlain = decideNegotiationUpdateAction(mkTextUpdate({ topicId: 42, text: words }), String(PRINCIPAL_ID), '1', 42);
      assert.deepEqual(negPhoto, negPlain, 'negotiation classification must not see the note');
    }),
    { numRuns: 150 }
  );
});

test('BL-955 invariant 2: a control command sent as a photo caption executes exactly as typed - the parser text is unannotated', async () => {
  const runControl = async (update) => {
    const armed = [];
    await pollAndForward(0, PRINCIPAL_ID, {
      chatId: '1',
      getUpdates: async () => ({ success: true, updates: [update] }),
      controlTopicId: async () => 900,
      getPendingControlConfirm: async () => undefined,
      setPendingControlConfirm: async (c) => armed.push(c),
      getPauseState: async () => ({ active: false }),
      postControlStopModesMenu: async () => {},
      subjectForTopic: () => undefined,
      backlogForTopic: () => undefined,
      postToBridge: async () => true,
      openSubjectAndRecord: async () => 'SUP-9',
    });
    return armed;
  };
  const viaCaption = await runControl(mkPhotoUpdate({ topicId: 900, caption: '/stop' }));
  const viaText = await runControl(mkTextUpdate({ topicId: 900, text: '/stop' }));
  assert.deepEqual(viaCaption, viaText);
  assert.deepEqual(viaCaption, [{ kind: 'stop-modes' }]);
});
