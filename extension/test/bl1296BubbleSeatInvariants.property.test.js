'use strict';

// BL-1296's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`.
//
//   invariant 1  The Bubble seat never diverges from the front desk: a mirror
//                served by its own worker, never an independent responder with
//                its own separate context.
//   invariant 2  A seat answers only its own topic - the Bubble worker never
//                serves the cursor host topic or the front desk, and the
//                Cursor seat never serves the Bubble topic.
//   invariant 3  Exactly one getUpdates owner exists at all times; adding the
//                second seat opens no competing poller.
//
// Invariants 1 and 2 drive the SHIPPED decision over generated topics and
// states. Invariant 3 is a property of WHERE the seat runs rather than of a
// value it returns, so it is measured against the shipped sources: the seat
// module opens no poller, and the bridge dispatches it from inside the one
// poll that already exists.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const {
  decideBubbleSeatTurn,
  formatBubbleSeatRefusal,
  BUBBLE_SEAT_NAME,
  CURSOR_SEAT_NAME,
} = require('../out/tools/bubbleSeat');
const { runBubbleSeatTurn } = require('../out/tools/bubbleSeatLive');

const SRC = path.join(__dirname, '..', 'src', 'tools');
const BUBBLE_TOPIC = 11810;
const CURSOR_TOPIC = 8435;

const topicArb = fc.oneof(
  fc.constant(BUBBLE_TOPIC),
  fc.constant(CURSOR_TOPIC),
  fc.constant(undefined),
  fc.integer({ min: 1, max: 99999 }),
);

test('BL-1296/BL-654 invariant 1: every answer is the front desk mirror, whatever the state', () => {
  // GENERATOR REACH (by construction): cursorBusy is enumerated rather than
  // drawn, because "busy" is the exact state the ticket exists for - a run
  // that never saw it would prove nothing. The answer must be identical in
  // both, which is what "a mirror with its own worker" means operationally:
  // no separate context, and no dependence on what cursor is doing.
  const reach = { busy: 0, idle: 0 };

  for (const cursorBusy of [true, false]) {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), () => {
        reach[cursorBusy ? 'busy' : 'idle'] += 1;
        const decided = decideBubbleSeatTurn({
          topicId: BUBBLE_TOPIC,
          seatTopicId: BUBBLE_TOPIC,
          cursorTopicId: CURSOR_TOPIC,
          cursorBusy,
          mirrorAvailable: true,
        });
        assert.equal(decided.kind, 'answer');
        assert.equal(decided.via, 'front-desk-mirror', 'the seat answered from something other than the mirror');
        assert.ok(!('context' in decided) && !('history' in decided), 'the decision carries a context of its own');
        return true;
      }),
      { numRuns: 6 },
    );
  }
  assert.ok(reach.busy > 0 && reach.idle > 0, 'never exercised both cursor states');

  // ...and the answer is byte-identical across those states: a mirror that
  // answered differently while cursor was busy would be diverging.
  const busy = decideBubbleSeatTurn({ topicId: BUBBLE_TOPIC, seatTopicId: BUBBLE_TOPIC, cursorBusy: true, mirrorAvailable: true });
  const idle = decideBubbleSeatTurn({ topicId: BUBBLE_TOPIC, seatTopicId: BUBBLE_TOPIC, cursorBusy: false, mirrorAvailable: true });
  assert.deepEqual(busy, idle);

  // The type itself is the durable half: there is exactly one `answer` shape,
  // and it is the mirror. A second brain cannot be built without changing it.
  const seatSource = fs.readFileSync(path.join(SRC, 'bubbleSeat.ts'), 'utf8');
  const viaValues = [...seatSource.matchAll(/via:\s*'([a-z-]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(viaValues)], ['front-desk-mirror'], 'a second answer source appeared');
});

// Invariant 1's strongest form, now that the live turn exists (the human's
// ruling: strict echo, "relays the front desk's own answer and produces none
// of its own"). Divergence is not merely absent from the decision type - the
// TEXT that reaches the topic is the front desk's own, byte for byte, for any
// reply the front desk can return.
test("BL-1296/BL-654 invariant 1: the posted text is the front desk's own, byte for byte", async () => {
  const reach = { busy: 0, idle: 0 };
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 200 }).filter((t) => t.trim().length > 0),
      fc.boolean(),
      async (replyText, cursorBusy) => {
        reach[cursorBusy ? 'busy' : 'idle'] += 1;
        const posted = [];
        await runBubbleSeatTurn({
          targetPath: '/nowhere',
          topicId: BUBBLE_TOPIC,
          seatTopicId: BUBBLE_TOPIC,
          cursorTopicId: CURSOR_TOPIC,
          cursorBusy,
          text: 'anything',
          post: async (topicId, message) => posted.push({ topicId, message }),
          frontDeskTurnFn: async () => ({ success: true, replyText }),
        });
        assert.deepEqual(posted, [{ topicId: BUBBLE_TOPIC, message: replyText }]);
        return true;
      },
    ),
    { numRuns: 30 },
  );
  assert.ok(reach.busy > 0 && reach.idle > 0, JSON.stringify(reach));
});

// And the seat never invents an answer when the front desk has none: the only
// text it authors is a refusal that names the reason it was given.
test('BL-1296/BL-654 invariant 1: a front desk that cannot answer yields a refusal naming its reason', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 80 }).filter((r) => r.trim().length > 0 && !/[\n\r]/.test(r)),
      async (reason) => {
        const posted = [];
        await runBubbleSeatTurn({
          targetPath: '/nowhere',
          topicId: BUBBLE_TOPIC,
          seatTopicId: BUBBLE_TOPIC,
          cursorTopicId: CURSOR_TOPIC,
          text: 'anything',
          post: async (topicId, message) => posted.push({ topicId, message }),
          frontDeskTurnFn: async () => ({ success: false, reason }),
        });
        assert.equal(posted.length, 1);
        assert.equal(posted[0].topicId, BUBBLE_TOPIC);
        assert.ok(posted[0].message.includes(reason), posted[0].message);
        assert.ok(posted[0].message.includes('No other seat has been asked.'), posted[0].message);
        return true;
      },
    ),
    { numRuns: 25 },
  );
});

test('BL-1296/BL-654 invariant 2: a seat answers only its own topic', () => {
  // GENERATOR REACH: the two live topics are in the pool by construction, and
  // the run fails unless it saw both plus a foreign one - a property that
  // never asked about cursor's topic could not catch cross-answering.
  const reach = { own: 0, cursor: 0, foreign: 0, unbound: 0 };

  fc.assert(
    fc.property(topicArb, fc.boolean(), fc.boolean(), (topicId, cursorBusy, mirrorAvailable) => {
      const decided = decideBubbleSeatTurn({
        topicId,
        seatTopicId: BUBBLE_TOPIC,
        cursorTopicId: CURSOR_TOPIC,
        cursorBusy,
        mirrorAvailable,
      });
      if (topicId === BUBBLE_TOPIC) {
        reach.own += 1;
        assert.ok(['answer', 'refuse'].includes(decided.kind), 'the seat ignored its own topic');
        assert.equal(decided.seat, BUBBLE_SEAT_NAME);
        assert.equal(decided.topicId, BUBBLE_TOPIC, 'the seat replied into a topic other than its own');
        return true;
      }
      if (topicId === CURSOR_TOPIC) reach.cursor += 1;
      else if (topicId === undefined) reach.unbound += 1;
      else reach.foreign += 1;
      // Everything else: not this seat's. It says nothing - no answer, no
      // refusal, and nothing addressed to another topic.
      assert.equal(decided.kind, 'not-mine', `the Bubble seat claimed topic ${topicId}`);
      assert.ok(!('topicId' in decided), 'a not-mine decision still names a topic to post into');
      if (topicId === CURSOR_TOPIC) assert.equal(decided.seat, CURSOR_SEAT_NAME);
      return true;
    }),
    { numRuns: 40 },
  );

  assert.ok(reach.own > 0, "never exercised the seat's own topic");
  assert.ok(reach.cursor > 0, "never exercised cursor's host topic - the cross-answering case");
  assert.ok(reach.foreign > 0, 'never exercised a third topic');
  assert.ok(reach.unbound > 0, 'never exercised a message with no topic at all');

  // An unbound seat claims nothing, for any topic at all.
  fc.assert(
    fc.property(topicArb, (topicId) => {
      assert.equal(decideBubbleSeatTurn({ topicId, seatTopicId: undefined, mirrorAvailable: true }).kind, 'not-mine');
      return true;
    }),
    { numRuns: 10 },
  );

  // And a refusal never hands the turn on, whatever the reason.
  fc.assert(
    fc.property(fc.string({ maxLength: 60 }), (reason) => {
      const decided = decideBubbleSeatTurn({
        topicId: BUBBLE_TOPIC,
        seatTopicId: BUBBLE_TOPIC,
        mirrorAvailable: false,
        mirrorUnavailableReason: reason,
      });
      assert.equal(decided.kind, 'refuse');
      assert.ok(!('delegateTo' in decided), 'a refusal names somewhere to hand the turn');
      assert.match(formatBubbleSeatRefusal(decided), /No other seat has been asked/);
      return true;
    }),
    { numRuns: 10 },
  );
});

test('BL-1296/BL-654 invariant 3: the second seat opens no competing poller', () => {
  // Where the seat RUNS is the whole claim, so it is measured against the
  // shipped sources rather than a return value. Comment lines are stripped
  // first: this invariant is why the code is shaped as it is, so it is
  // discussed in comments, and matching those would red on documentation.
  const stripComments = (text) =>
    text
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');

  const seat = stripComments(fs.readFileSync(path.join(SRC, 'bubbleSeat.ts'), 'utf8'));
  assert.ok(!/getUpdates\s*\(|startPolling|new\s+TelegramBot/.test(seat), 'the seat module opens a poller of its own');
  assert.ok(!/fetch\s*\(|https?:\/\//.test(seat), 'the seat module talks to Telegram directly');

  const bridge = fs.readFileSync(path.join(SRC, 'telegramCursorBridgeLive.ts'), 'utf8');
  const dispatchAt = bridge.indexOf('inbound.topicId === deps.bubbleSeatTopicId');
  assert.ok(dispatchAt > 0, 'the bridge poll does not dispatch the Bubble seat at all');
  // Dispatched from inside the SAME loop that already owns getUpdates, and
  // ahead of cursor's decision.
  assert.ok(
    dispatchAt < bridge.indexOf('const rawDecision = decideInboundAction('),
    "the Bubble seat is dispatched after cursor's own decision"
  );
  const getUpdatesOwners = [...bridge.matchAll(/getUpdates/g)].length;
  assert.ok(getUpdatesOwners > 0, 'the bridge no longer polls at all - this check would be vacuous');
});
