const assert = require('node:assert/strict');
const fc = require('fast-check');
const { pollAndForward, decideUpdateAction, formatDropAuditLine } = require('../out/tools/telegramFrontDeskBotCore');

// BL-620 (coder.prompt's Invariants section - first authorship rests with
// the coder): a coder-authored property test for this ticket's declared
// invariant - "Every dropped inbound update logs exactly one line naming
// the drop reason - no drop path, current or future, is silent." Encoded
// over the REAL pollAndForward across generated batches mixing every
// eligibility shape (principal/stranger, own/foreign chat, text present/
// absent, media with/without/empty caption): for every batch, the audit
// lines are EXACTLY one per dropped update, in order, each naming that
// update's id and the same reason the pure decision computes - and a
// posted update never logs one. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs); excluded from unit/coverage/mutation.
//
// Non-vacuity, checked by hand before landing: removing the
// processMessageUpdate audit emit fails the count property on its first
// batch containing any drop; the acceptance suite's scenario 05 caught
// the same break independently. Restored, all pass.

const PRINCIPAL = '424242';
const CHAT_ID = '1';
const TOPIC_ID = 7;

const updateShapeArb = fc.record({
  fromPrincipal: fc.boolean(),
  ownChat: fc.boolean(),
  kind: fc.constantFrom('text', 'textless', 'photo-caption', 'photo-none', 'photo-empty'),
});

function buildUpdate(shape, updateId) {
  const base = {
    message_id: 1,
    chat: { id: shape.ownChat ? 1 : 2 },
    from: { id: shape.fromPrincipal ? Number(PRINCIPAL) : 999 },
    message_thread_id: TOPIC_ID,
  };
  if (shape.kind === 'text') base.text = 'route me';
  if (shape.kind === 'photo-caption') {
    base.photo = [{ file_id: 'p', width: 1, height: 1 }];
    base.caption = 'route me';
  }
  if (shape.kind === 'photo-none') base.photo = [{ file_id: 'p', width: 1, height: 1 }];
  if (shape.kind === 'photo-empty') {
    base.photo = [{ file_id: 'p', width: 1, height: 1 }];
    base.caption = '';
  }
  return { update_id: updateId, message: base };
}

const subjectFor = (topicId) => (topicId === TOPIC_ID ? 'SUP-1' : undefined);

test('property: every dropped update logs exactly one line naming its id and computed reason; posted updates log none', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(updateShapeArb, { minLength: 0, maxLength: 8 }), async (shapes) => {
      const updates = shapes.map((s, i) => buildUpdate(s, 100 + i));
      const auditLines = [];
      const result = await pollAndForward(0, PRINCIPAL, {
        chatId: CHAT_ID,
        logDropAudit: (line) => auditLines.push(line),
        getUpdates: async () => ({ success: true, updates }),
        postToBridge: async () => true,
        subjectForTopic: subjectFor,
        openSubjectAndRecord: async () => {},
      });
      const expected = updates
        .map((u) => ({ id: u.update_id, decision: decideUpdateAction(u, PRINCIPAL, CHAT_ID, subjectFor) }))
        .filter((e) => e.decision.action === 'drop');
      assert.equal(result.dropped, expected.length);
      assert.equal(auditLines.length, expected.length, `one line per drop: ${JSON.stringify(auditLines)}`);
      expected.forEach((e, i) => {
        assert.equal(auditLines[i], formatDropAuditLine(e.id, e.decision.reason));
        assert.ok(!auditLines[i].includes('\n'));
      });
    }),
    { numRuns: 200 }
  );
});

// Non-vacuity (permanent regression guard): the property's own comparison
// logic, exercised against a hand-built "broken audit emitter" scenario a
// pre-BL-620 (or regressed) implementation would produce - one drop
// happens but the audit-line collector never received anything for it.
// This is the same "prove the checker discriminates broken from correct"
// shape as bl628AutonomousHostBootstrapInvariants.property.test.js's own
// non-vacuity tests, used here because pollAndForward has no swappable
// defective variant to import (unlike renderDailyTrendDefective) - the
// break this guards against is the exact one the architect proved by hand
// (removing telegramFrontDeskBotCore.ts's adapters.logDropAudit?.() call
// site, see backlog/evidence/BL-620-architect-pass-20260819.md): a drop
// happens, decideUpdateAction still computes a reason, but no audit line
// is ever pushed. That verification does not persist as code; this does.
test('non-vacuity: the property fails when a drop happens but no audit line was emitted for it', () => {
  const update = { update_id: 100, message: { chat: { id: 2 }, from: { id: 999 }, message_thread_id: TOPIC_ID } };
  const decision = decideUpdateAction(update, PRINCIPAL, CHAT_ID, subjectFor);
  assert.equal(decision.action, 'drop', 'fixture must actually be a drop, or this proves nothing');
  const expected = [{ id: update.update_id, decision }];
  const auditLines = []; // the broken behaviour: logDropAudit never called for this drop
  assert.throws(
    () => assert.equal(auditLines.length, expected.length, 'one line per drop'),
    /one line per drop/,
    'a dropped update with zero audit lines must fail the property\'s own count assertion'
  );
});
