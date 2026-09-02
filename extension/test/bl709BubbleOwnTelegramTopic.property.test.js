'use strict';

// BL-709 declared invariants (BL-1311 restore — coverage was lost to a merge,
// see BL-1311's ticket notes; not a verbatim recreation, equivalent coverage
// of the same contract).
// Quantifies Bubble vs Cursor Remote destination separation over generated
// topic-id bags and front-desk maps.
// Non-vacuity (authoring): forcing mirror topic to always equal cursorTopicId
// fails P1; leaving Bubble/Cursor keys in the scrubbed map fails P2; throwing
// when bubble unbound fails P3. Runs via npm run test:properties.

const assert = require('node:assert/strict');
const fc = require('fast-check');

const {
  effectiveBubbleMirrorTopicId,
  effectiveLetsTalkMirrorTopicId,
} = require('../out/bridge/bridgeServer');
const {
  BUBBLE_SUBJECT_ID,
  CURSOR_BRIDGE_SUBJECT_ID,
  frontDeskTopicMapWithoutCursorBridge,
  decideEnsureBubbleTopicAction,
  isOwnedCursorBridgeTopic,
} = require('../out/tools/telegramCursorBridgeCore');

const topicIdArb = fc.integer({ min: 1, max: 999_999 });

test('BL-709 P1: bound Bubble never mirrors Lets Talk onto Cursor Remote', () => {
  let reached = 0;
  fc.assert(
    fc.property(topicIdArb, topicIdArb, (cursor, bubble) => {
      fc.pre(cursor !== bubble);
      const ids = { cursorTopicId: cursor, bubbleTopicId: bubble };
      assert.equal(effectiveBubbleMirrorTopicId(ids), bubble);
      assert.equal(effectiveLetsTalkMirrorTopicId(ids), bubble);
      assert.notEqual(effectiveLetsTalkMirrorTopicId(ids), cursor);
      reached += 1;
    }),
    { numRuns: 40 }
  );
  assert.ok(reached >= 10);
});

test('BL-709 P2: front-desk export never claims Bubble or Cursor Remote topic ids', () => {
  let reached = 0;
  fc.assert(
    fc.property(
      topicIdArb,
      topicIdArb,
      fc.dictionary(fc.stringMatching(/^[1-9][0-9]{0,5}$/), fc.constantFrom('SPEC', 'QA', 'SUP', 'OTHER'), {
        maxKeys: 6,
      }),
      (cursor, bubble, extra) => {
        fc.pre(cursor !== bubble);
        const map = {
          ...extra,
          [String(cursor)]: CURSOR_BRIDGE_SUBJECT_ID,
          [String(bubble)]: BUBBLE_SUBJECT_ID,
        };
        const scrubbed = frontDeskTopicMapWithoutCursorBridge(map, cursor, [bubble]);
        assert.equal(scrubbed[String(cursor)], undefined);
        assert.equal(scrubbed[String(bubble)], undefined);
        assert.ok(!Object.values(scrubbed).includes(CURSOR_BRIDGE_SUBJECT_ID));
        assert.ok(!Object.values(scrubbed).includes(BUBBLE_SUBJECT_ID));
        reached += 1;
      }
    ),
    { numRuns: 30 }
  );
  assert.ok(reached >= 8);
});

test('BL-709 P3: unbound Bubble degrades without crash — Cursor Remote mirror + ensure create', () => {
  let reached = 0;
  fc.assert(
    fc.property(topicIdArb, (cursor) => {
      const unbound = { cursorTopicId: cursor };
      assert.equal(effectiveBubbleMirrorTopicId(unbound), undefined);
      assert.equal(effectiveLetsTalkMirrorTopicId(unbound), cursor);
      assert.deepEqual(decideEnsureBubbleTopicAction({ [String(cursor)]: CURSOR_BRIDGE_SUBJECT_ID }), {
        kind: 'create',
      });
      assert.equal(
        isOwnedCursorBridgeTopic(cursor, unbound),
        true
      );
      reached += 1;
    }),
    { numRuns: 30 }
  );
  assert.ok(reached >= 10);
});
