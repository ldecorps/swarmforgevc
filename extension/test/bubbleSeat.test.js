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

test('an unbound message with no cursor topic to compare against names no seat either', () => {
  // Discriminates `topicId !== undefined && topicId === cursorTopicId` from a
  // mutant that drops the `topicId !== undefined` guard: with both topicId
  // and cursorTopicId undefined, `undefined === undefined` alone would wrongly
  // name Cursor.
  const decided = turn({ topicId: undefined, cursorTopicId: undefined });
  assert.equal(decided.kind, 'not-mine');
  assert.equal(decided.seat, undefined);
});

test('an unbound Bubble seat never claims a message', () => {
  assert.equal(turn({ seatTopicId: undefined }).kind, 'not-mine');
  assert.equal(turn({ topicId: undefined }).kind, 'not-mine');
});

test('an unbound seat never claims an unaddressed message either - both undefined is still not a match', () => {
  // Discriminates `topicId === undefined` from a mutant that drops that
  // clause entirely: with seatTopicId ALSO undefined, `topicId !==
  // seatTopicId` is `undefined !== undefined` = false, so only the
  // `topicId === undefined` clause on its own catches this case. Neither of
  // the two calls above puts both at undefined simultaneously.
  assert.equal(turn({ topicId: undefined, seatTopicId: undefined }).kind, 'not-mine');
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
  // Pin the actual default reason text, not just "something longer than the
  // prefix" - a mutant that falls back to '' still produces a longer string
  // via the trailing ". No other seat has been asked." sentence.
  assert.equal(text, 'Bubble seat cannot answer: the front desk mirror is unavailable for this turn. No other seat has been asked.');
});

test('the watchdog reports a stopped seat by name, and stays quiet about a live one', () => {
  const watch = decideSeatWatch([
    { name: BUBBLE_SEAT_NAME, alive: false },
    { name: CURSOR_SEAT_NAME, alive: true },
  ]);
  assert.deepEqual(watch.needsAttention, [BUBBLE_SEAT_NAME]);
  // Exact match: kills the `stopped: []` fallback ArrayDeclaration mutant
  // (would leak "Stryker was here" into a still-empty `unknown` branch) and
  // pins the message shape overall.
  assert.equal(watch.message, 'seats needing attention — stopped: Bubble');
});

test('the watchdog joins MULTIPLE stopped seats with ", ", not concatenated bare', () => {
  // A single-element fixture cannot discriminate `join(', ')` from
  // `join("")` - both produce the same string for one element.
  const watch = decideSeatWatch([
    { name: BUBBLE_SEAT_NAME, alive: false },
    { name: CURSOR_SEAT_NAME, alive: false },
  ]);
  assert.deepEqual(watch.needsAttention, [BUBBLE_SEAT_NAME, CURSOR_SEAT_NAME]);
  assert.equal(watch.message, 'seats needing attention — stopped: Bubble, Cursor');
});

test('the watchdog reports stopped AND unknown seats together, separated by "; "', () => {
  // Only a fixture with BOTH `parts` populated can discriminate the outer
  // `parts.join('; ')` separator.
  const watch = decideSeatWatch([
    { name: BUBBLE_SEAT_NAME, alive: false },
    { name: CURSOR_SEAT_NAME, alive: undefined },
  ]);
  assert.deepEqual(watch.needsAttention, [BUBBLE_SEAT_NAME, CURSOR_SEAT_NAME]);
  assert.equal(watch.message, 'seats needing attention — stopped: Bubble; liveness unknown: Cursor');
});

test('with both seats alive the watchdog says so rather than going quiet', () => {
  const watch = decideSeatWatch([
    { name: BUBBLE_SEAT_NAME, alive: true },
    { name: CURSOR_SEAT_NAME, alive: true },
  ]);
  assert.deepEqual(watch.needsAttention, []);
  // Exact match: kills both the `join(', ')` -> `join("")` mutant (needs 2+
  // names to differ) and the `s => s.name` -> `s => undefined` mutant.
  assert.equal(watch.message, 'all seats running: Bubble, Cursor');
});

test('a seat whose liveness is unknown is reported, never assumed alive', () => {
  const watch = decideSeatWatch([{ name: BUBBLE_SEAT_NAME, alive: undefined }]);
  assert.deepEqual(watch.needsAttention, [BUBBLE_SEAT_NAME]);
  // Exact match: kills the `unknown: []` fallback ArrayDeclaration mutant
  // (would leak "Stryker was here" into the still-empty `stopped` branch).
  assert.equal(watch.message, 'seats needing attention — liveness unknown: Bubble');
});

test('the watchdog joins MULTIPLE unknown seats with ", ", not concatenated bare', () => {
  const watch = decideSeatWatch([
    { name: BUBBLE_SEAT_NAME, alive: undefined },
    { name: CURSOR_SEAT_NAME, alive: undefined },
  ]);
  assert.deepEqual(watch.needsAttention, [BUBBLE_SEAT_NAME, CURSOR_SEAT_NAME]);
  assert.equal(watch.message, 'seats needing attention — liveness unknown: Bubble, Cursor');
});
