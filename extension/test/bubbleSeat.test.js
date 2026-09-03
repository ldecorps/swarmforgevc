'use strict';

// BL-1296: the Bubble seat answers in its OWN topic, from its own worker, while
// the Cursor seat is mid-turn - and stays a MIRROR of the front desk rather
// than becoming a second brain.
const assert = require('node:assert/strict');
const {
  decideBubbleSeatTurn,
  formatBubbleSeatRefusal,
  decideSeatWatch,
  BUBBLE_SEAT_NAME,
  CURSOR_SEAT_NAME,
} = require('../out/tools/bubbleSeat');

const BUBBLE_TOPIC = 11810;
const CURSOR_TOPIC = 8435;

function turn(over = {}) {
  return decideBubbleSeatTurn({
    topicId: BUBBLE_TOPIC,
    seatTopicId: BUBBLE_TOPIC,
    cursorTopicId: CURSOR_TOPIC,
    cursorBusy: false,
    mirrorAvailable: true,
    ...over,
  });
}

test('a message in the Bubble topic is answered by the Bubble seat, from the front desk mirror', () => {
  const decided = turn();
  assert.equal(decided.kind, 'answer');
  assert.equal(decided.seat, BUBBLE_SEAT_NAME);
  // The mirror is structural: the answer's source is the front desk's shared
  // context, and the decision offers no seat-private-context alternative.
  assert.equal(decided.via, 'front-desk-mirror');
});

test('the Cursor seat being mid-turn changes nothing - that is the whole point of the ticket', () => {
  const busy = turn({ cursorBusy: true });
  assert.equal(busy.kind, 'answer');
  assert.deepEqual(busy, turn({ cursorBusy: false }), 'the decision depends on cursor being busy');
});

test("a message in cursor's host topic is not this seat's - it says nothing at all", () => {
  const decided = turn({ topicId: CURSOR_TOPIC });
  assert.equal(decided.kind, 'not-mine');
  assert.equal(decided.seat, CURSOR_SEAT_NAME, 'the decision does not say whose topic it is');
});

test('a message in some third topic is not this seat\'s either, and names no other seat to hand it to', () => {
  const decided = turn({ topicId: 999 });
  assert.equal(decided.kind, 'not-mine');
  assert.equal(decided.seat, undefined);
});

test('an unbound Bubble seat never claims a message', () => {
  assert.equal(turn({ seatTopicId: undefined }).kind, 'not-mine');
  assert.equal(turn({ topicId: undefined }).kind, 'not-mine');
});

test('a seat that cannot answer refuses IN ITS OWN TOPIC, naming why, and hands the turn to nobody', () => {
  const decided = turn({ mirrorAvailable: false, mirrorUnavailableReason: 'the front desk context is unreadable' });
  assert.equal(decided.kind, 'refuse');
  assert.equal(decided.seat, BUBBLE_SEAT_NAME);
  assert.equal(decided.topicId, BUBBLE_TOPIC, 'the refusal is not addressed to the topic it arrived in');
  const text = formatBubbleSeatRefusal(decided);
  assert.match(text, /the front desk context is unreadable/);
  assert.match(text, /No other seat has been asked/);
  // The type carries no delegate/fallback case: a caller cannot route a
  // refusal elsewhere, because the decision offers nowhere to route to.
  assert.ok(!('delegateTo' in decided));
});

test('a refusal with no stated reason still says something a reader can act on', () => {
  const text = formatBubbleSeatRefusal(turn({ mirrorAvailable: false }));
  assert.match(text, /Bubble seat cannot answer/);
  assert.ok(text.trim().length > 'Bubble seat cannot answer:'.length);
});

test('the watchdog reports a stopped seat by name, and stays quiet about a live one', () => {
  const watch = decideSeatWatch([
    { name: BUBBLE_SEAT_NAME, alive: false },
    { name: CURSOR_SEAT_NAME, alive: true },
  ]);
  assert.deepEqual(watch.needsAttention, [BUBBLE_SEAT_NAME]);
  assert.match(watch.message, /Bubble/);
  assert.ok(!/Cursor/.test(watch.message), 'a live seat is reported as needing attention');
});

test('the watchdog covers BOTH seats - a stopped Cursor seat is reported too', () => {
  const watch = decideSeatWatch([
    { name: BUBBLE_SEAT_NAME, alive: true },
    { name: CURSOR_SEAT_NAME, alive: false },
  ]);
  assert.deepEqual(watch.needsAttention, [CURSOR_SEAT_NAME]);
});

test('with both seats alive the watchdog says so rather than going quiet', () => {
  const watch = decideSeatWatch([
    { name: BUBBLE_SEAT_NAME, alive: true },
    { name: CURSOR_SEAT_NAME, alive: true },
  ]);
  assert.deepEqual(watch.needsAttention, []);
  assert.match(watch.message, /both seats|all seats/i);
});

test('a seat whose liveness is unknown is reported, never assumed alive', () => {
  const watch = decideSeatWatch([{ name: BUBBLE_SEAT_NAME, alive: undefined }]);
  assert.deepEqual(watch.needsAttention, [BUBBLE_SEAT_NAME]);
  assert.match(watch.message, /unknown/i);
});
