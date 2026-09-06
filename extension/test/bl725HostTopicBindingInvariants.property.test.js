'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { ensureCursorTopic } = require('../out/tools/telegramCursorBridgeLive');
const { CURSOR_BRIDGE_SUBJECT_ID } = require('../out/tools/telegramCursorBridgeCore');

// BL-725 declared invariant (coder-authored per BL-654): "The existing
// bound topic keeps working: the subject id CURSOR_REMOTE and the
// topic-map key are unchanged, so no second topic is ever created and
// slash verbs plus typed host prompts keep landing on the already-bound
// thread." Runs ONLY via `npm run test:properties`.
//
// Property: for ANY already-bound thread id, ensureCursorTopic resolves to
// EXACTLY that thread id and never calls createTopic - the rename (which
// only changes the NAME passed on the create path) can never disturb an
// existing binding, because the binding is keyed by subject id, never by
// name. Generator reach: thread ids span the realistic Telegram range
// (small ids through very large ones) plus zero, a boundary a naive
// truthiness check ({} vs 0) could get wrong.

const threadIdArb = fc.integer({ min: 0, max: 2_147_483_647 });

test('BL-725 invariant: an existing CURSOR_REMOTE binding is always reused, never recreated, whatever thread id it names', async () => {
  await fc.assert(
    fc.asyncProperty(threadIdArb, async (threadId) => {
      const root = mkTmpDir('bl725-inv-');
      const topicMapPath = path.join(root, 'topic-map.json');
      fs.writeFileSync(topicMapPath, JSON.stringify({ [String(threadId)]: CURSOR_BRIDGE_SUBJECT_ID }), 'utf8');

      let createCalls = 0;
      const stubCreateTopic = async () => {
        createCalls += 1;
        return { success: true, messageThreadId: -1 };
      };

      const state = await ensureCursorTopic('fake-token', 'fake-chat', topicMapPath, { updateOffset: 0 }, stubCreateTopic);
      assert.equal(createCalls, 0, `expected no create call for thread ${threadId}, got ${createCalls}`);
      assert.equal(state.cursorTopicId, threadId, `expected the existing binding ${threadId} to be reused, got ${state.cursorTopicId}`);
    }),
    { numRuns: 100 }
  );
});
