'use strict';

// BL-1296, the human's ruling (option 1): "Strict echo - the Bubble seat
// relays the front desk's own answer and produces none of its own."
//
// So the live turn does not answer. It drives the FRONT DESK's own turn path
// and posts what that returns, which is what makes invariant 1 structural
// rather than remembered: there is no code path here that composes a reply.
//
// Every edge is injected, so the whole turn runs in-process with no agent, no
// Telegram and no network.

const assert = require('node:assert/strict');
const { runBubbleSeatTurn } = require('../out/tools/bubbleSeatLive');
const { BUBBLE_SEAT_NAME } = require('../out/tools/bubbleSeat');

const SEAT_TOPIC = 11810;
const CURSOR_TOPIC = 8435;

function turn(over = {}) {
  const posted = [];
  const frontDeskCalls = [];
  return runBubbleSeatTurn({
    targetPath: '/nowhere',
    topicId: SEAT_TOPIC,
    seatTopicId: SEAT_TOPIC,
    cursorTopicId: CURSOR_TOPIC,
    text: 'what is the swarm doing?',
    post: async (topicId, message) => posted.push({ topicId, message }),
    frontDeskTurnFn: async (text) => {
      frontDeskCalls.push(text);
      return { success: true, replyText: 'the front desk says: three parcels in flight' };
    },
    ...over,
  }).then(() => ({ posted, frontDeskCalls }));
}

test('the seat posts the front desk\'s own answer, verbatim', async () => {
  const { posted, frontDeskCalls } = await turn();
  assert.deepEqual(frontDeskCalls, ['what is the swarm doing?']);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].topicId, SEAT_TOPIC);
  assert.equal(posted[0].message, 'the front desk says: three parcels in flight');
});

// Invariant 1, the whole point of the ruling: the seat never composes a reply.
// Whatever the front desk returns is what reaches the topic, unedited.
test('whatever the front desk returns is what reaches the topic', async () => {
  for (const replyText of ['plain', 'multi\nline\nanswer', '  padded  ', 'ø unicode ✓']) {
    const { posted } = await turn({
      frontDeskTurnFn: async () => ({ success: true, replyText }),
    });
    assert.equal(posted[0].message, replyText);
  }
});

// Invariant 2: a seat serves only its own topic, and the gate is first - the
// front desk is not even asked about a message that is not this seat's.
test('a message in another topic is not answered and does not reach the front desk', async () => {
  for (const topicId of [CURSOR_TOPIC, 999, undefined]) {
    const { posted, frontDeskCalls } = await turn({ topicId });
    assert.deepEqual(posted, [], `topic ${topicId} was answered`);
    assert.deepEqual(frontDeskCalls, [], `topic ${topicId} reached the front desk`);
  }
});

test('a seat bound to no topic answers nothing at all', async () => {
  const { posted, frontDeskCalls } = await turn({ seatTopicId: undefined });
  assert.deepEqual(posted, []);
  assert.deepEqual(frontDeskCalls, []);
});

// "A Bubble seat that cannot answer says why in its own topic; it never fails
// silently and never hands the turn to another seat" - the intake's own words.
test('a front desk that cannot answer produces a refusal in the seat\'s own topic, naming why', async () => {
  const { posted } = await turn({
    frontDeskTurnFn: async () => ({ success: false, reason: 'the agent session is unavailable' }),
  });
  assert.equal(posted.length, 1);
  assert.equal(posted[0].topicId, SEAT_TOPIC);
  assert.match(posted[0].message, /cannot answer/);
  assert.match(posted[0].message, /the agent session is unavailable/);
  assert.match(posted[0].message, /No other seat has been asked\./);
  assert.match(posted[0].message, new RegExp(BUBBLE_SEAT_NAME));
});

test('a front desk that throws is still a named refusal, never silence', async () => {
  const { posted } = await turn({
    frontDeskTurnFn: async () => {
      throw new Error('ECONNREFUSED talking to the agent');
    },
  });
  assert.equal(posted.length, 1);
  assert.match(posted[0].message, /ECONNREFUSED talking to the agent/);
});

test('a front desk that returns an empty answer refuses rather than posting nothing', async () => {
  const { posted } = await turn({
    frontDeskTurnFn: async () => ({ success: true, replyText: '   ' }),
  });
  assert.equal(posted.length, 1);
  // Pin the exact reason text mirrorUnavailableReasonFor's success branch
  // produces - a bare /cannot answer/ match still passes when that branch is
  // mutated to '', because decideBubbleSeatTurn's own truthy check on
  // mirrorUnavailableReason then omits `reason` entirely and
  // formatBubbleSeatRefusal falls back to its OWN default text, which also
  // contains "cannot answer".
  assert.equal(
    posted[0].message,
    'Bubble seat cannot answer: the front desk returned an empty answer. No other seat has been asked.'
  );
});

// The regression this ticket exists to remove, kept as a test rather than a
// comment: the seat's behaviour is byte-identical whether the Cursor seat is
// mid-turn or idle. A future edit that starts consulting it fails here.
test('the turn is identical whether the Cursor seat is busy or idle', async () => {
  const busy = await turn({ cursorBusy: true });
  const idle = await turn({ cursorBusy: false });
  assert.deepEqual(busy.posted, idle.posted);
  assert.deepEqual(busy.frontDeskCalls, idle.frontDeskCalls);
});
