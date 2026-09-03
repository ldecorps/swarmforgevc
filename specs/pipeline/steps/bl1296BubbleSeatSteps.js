'use strict';

// BL-1296: step handlers for "Bubble answers from its own seat while the
// Cursor seat is busy".
//
// The decisions are driven through the SHIPPED module (out/tools/bubbleSeat),
// and the routing scenarios drive the SHIPPED bridge poll loop's own dispatch
// shape - the seat runs inside that poll, which is what makes "no competing
// poller" true by construction rather than by assertion.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EXT_ROOT = path.join(__dirname, '..', '..', '..', 'extension');
const {
  decideBubbleSeatTurn,
  formatBubbleSeatRefusal,
  decideSeatWatch,
  BUBBLE_SEAT_NAME,
  CURSOR_SEAT_NAME,
} = require(path.join(EXT_ROOT, 'out', 'tools', 'bubbleSeat'));

const FEATURE = 'Bubble answers from its own seat while the Cursor seat is busy';
const BRIDGE_LIVE = path.join(EXT_ROOT, 'src', 'tools', 'telegramCursorBridgeLive.ts');

// The two live topic ids, from the shipped subject-id topic map
// (.swarmforge/operator/cursor-bridge-topic-map.json reads
// {"8435": "CURSOR_REMOTE", "11810": "BUBBLE"}).
const BUBBLE_TOPIC = 11810;
const CURSOR_TOPIC = 8435;

// Scenario Outline cells, checked against explicit known values.
const KNOWN_TOPICS = { Bubble: BUBBLE_TOPIC, 'cursor host': CURSOR_TOPIC };
const KNOWN_SEATS = { Bubble: BUBBLE_SEAT_NAME, Cursor: CURSOR_SEAT_NAME };

function state(ctx) {
  if (!ctx.bl1296) ctx.bl1296 = { cursorBusy: false, mirrorAvailable: true };
  return ctx.bl1296;
}

function decide(ctx, topicId) {
  const st = state(ctx);
  return decideBubbleSeatTurn({
    topicId,
    seatTopicId: BUBBLE_TOPIC,
    cursorTopicId: CURSOR_TOPIC,
    cursorBusy: st.cursorBusy,
    mirrorAvailable: st.mirrorAvailable,
    ...(st.mirrorUnavailableReason ? { mirrorUnavailableReason: st.mirrorUnavailableReason } : {}),
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a Bubble seat bound to the Bubble topic and a Cursor seat bound to the cursor host topic$/, (ctx) => {
    const st = state(ctx);
    st.bound = true;
    // The binding is one entry per seat in the subject-id topic map - the same
    // file BL-1235's seat binds through, not a second mechanism.
    const source = fs.readFileSync(BRIDGE_LIVE, 'utf8');
    assert.match(source, /bubbleSeatTopicId/, 'the bridge poll knows no Bubble seat topic');
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the Cursor seat is busy with a turn that has not finished$/, (ctx) => {
    state(ctx).cursorBusy = true;
  });

  scoped(/^a message arrives in the Bubble topic$/, (ctx) => {
    state(ctx).decided = decide(ctx, BUBBLE_TOPIC);
  });

  scoped(/^Bubble answers it without waiting for the Cursor seat to finish$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.decided.kind, 'answer', 'Bubble did not answer while cursor was mid-turn');
    assert.equal(st.decided.seat, BUBBLE_SEAT_NAME);
    // Answered from the front desk's shared context: a mirror with its own
    // worker, never a second brain (invariant 1).
    assert.equal(st.decided.via, 'front-desk-mirror');
    // ...and the SAME decision comes back with cursor idle, which is what
    // "without waiting" means as a measurement rather than a hope.
    const idle = decideBubbleSeatTurn({
      topicId: BUBBLE_TOPIC,
      seatTopicId: BUBBLE_TOPIC,
      cursorTopicId: CURSOR_TOPIC,
      cursorBusy: false,
      mirrorAvailable: true,
    });
    assert.deepEqual(st.decided, idle, "the Bubble seat's answer depends on cursor's turn");
    // The live dispatch is ahead of cursor's decision and is not gated on the
    // busy flag - the structural half of the same claim.
    const source = fs.readFileSync(BRIDGE_LIVE, 'utf8');
    const bubbleDispatch = source.slice(source.indexOf('inbound.topicId === deps.bubbleSeatTopicId'));
    const block = bubbleDispatch.slice(0, bubbleDispatch.indexOf('continue;'));
    assert.ok(!/ctx\.busy|deps\.busy/.test(block), "the Bubble dispatch consults cursor's busy flag");
    assert.ok(
      source.indexOf('inbound.topicId === deps.bubbleSeatTopicId') < source.indexOf('const rawDecision = decideInboundAction('),
      "the Bubble seat is dispatched after cursor's own decision"
    );
  });

  // ── Scenario 02 (outline) ────────────────────────────────────────────
  scoped(/^a message arrives in the (.+) topic$/, (ctx, topicName) => {
    const topicId = KNOWN_TOPICS[topicName];
    assert.ok(topicId !== undefined, `unknown topic cell: ${topicName}`);
    const st = state(ctx);
    st.subjectTopic = topicName;
    st.decided = decide(ctx, topicId);
  });

  scoped(/^it is answered by the (.+) seat only$/, (ctx, seatName) => {
    const seat = KNOWN_SEATS[seatName];
    assert.ok(seat, `unknown seat cell: ${seatName}`);
    const st = state(ctx);
    st.expectedSeat = seat;
    if (seat === BUBBLE_SEAT_NAME) {
      assert.equal(st.decided.kind, 'answer', 'the Bubble seat did not take its own topic');
      assert.equal(st.decided.seat, BUBBLE_SEAT_NAME);
    } else {
      // Cursor's topic: the Bubble seat is not asked at all - it does not
      // decline, it says nothing, and the message goes on to cursor's own
      // decision exactly as before this seat existed.
      assert.equal(st.decided.kind, 'not-mine', 'the Bubble seat claimed cursor\'s topic');
      assert.equal(st.decided.seat, CURSOR_SEAT_NAME);
    }
  });

  scoped(/^no other seat answers it$/, (ctx) => {
    const st = state(ctx);
    if (st.expectedSeat === BUBBLE_SEAT_NAME) {
      // The decision has no delegate/fallback case at all, so there is nothing
      // for a caller to route elsewhere on.
      assert.ok(!('delegateTo' in st.decided), 'the decision offers somewhere else to route');
      return;
    }
    // And the reverse direction: cursor's topic never reaches the Bubble
    // worker in the live loop, because the dispatch is gated on the Bubble
    // seat's own topic id.
    const source = fs.readFileSync(BRIDGE_LIVE, 'utf8');
    assert.match(
      source,
      /inbound\.topicId === deps\.bubbleSeatTopicId/,
      'the Bubble dispatch is not gated on the Bubble seat topic'
    );
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the Bubble seat cannot produce an answer$/, (ctx) => {
    const st = state(ctx);
    st.mirrorAvailable = false;
    st.mirrorUnavailableReason = 'the front desk context could not be read for this turn';
  });

  scoped(/^the reason is reported in the Bubble topic$/, (ctx) => {
    const st = state(ctx);
    assert.equal(st.decided.kind, 'refuse');
    assert.equal(st.decided.topicId, BUBBLE_TOPIC, 'the refusal is not addressed to the Bubble topic');
    const text = formatBubbleSeatRefusal(st.decided);
    assert.ok(text.includes(st.mirrorUnavailableReason), `the refusal does not name why: ${text}`);
  });

  scoped(/^the turn is not handed to another seat$/, (ctx) => {
    const st = state(ctx);
    assert.ok(!('delegateTo' in st.decided), 'the refusal names somewhere to hand the turn');
    assert.match(formatBubbleSeatRefusal(st.decided), /No other seat has been asked/);
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^the Bubble seat is running alongside the Cursor seat$/, (ctx) => {
    state(ctx).bothRunning = true;
  });

  scoped(/^exactly one getUpdates owner exists$/, () => {
    // Measured where it is decided: the seat is dispatched from INSIDE the
    // bridge's existing poll, so there is no second consumer to open. A seat
    // that started its own poller would need a getUpdates call of its own.
    const source = fs.readFileSync(BRIDGE_LIVE, 'utf8');
    const dispatchAt = source.indexOf('inbound.topicId === deps.bubbleSeatTopicId');
    assert.ok(dispatchAt > 0, 'the Bubble seat is not dispatched from the bridge poll at all');
    // Comments MENTION getUpdates (this invariant is why the seat is shaped
    // the way it is); what must not exist is a CALL. Strip comments first, or
    // the check reds on its own documentation.
    const seatModule = fs
      .readFileSync(path.join(EXT_ROOT, 'src', 'tools', 'bubbleSeat.ts'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    assert.ok(
      !/getUpdates\s*\(|startPolling|new\s+TelegramBot/.test(seatModule),
      'the Bubble seat module opens a poller of its own'
    );
  });

  // ── Scenario 05 ──────────────────────────────────────────────────────
  scoped(/^the Bubble seat has stopped unexpectedly$/, (ctx) => {
    state(ctx).seats = [
      { name: BUBBLE_SEAT_NAME, alive: false },
      { name: CURSOR_SEAT_NAME, alive: true },
    ];
  });

  scoped(/^the watchdog next checks the seats$/, (ctx) => {
    const st = state(ctx);
    st.watch = decideSeatWatch(st.seats);
  });

  scoped(/^it reports the Bubble seat as needing attention$/, (ctx) => {
    const st = state(ctx);
    assert.deepEqual(st.watch.needsAttention, [BUBBLE_SEAT_NAME]);
    assert.match(st.watch.message, /Bubble/);
    // The watchdog covers BOTH seats, so a live one is not reported and a
    // stopped cursor seat would be - a watchdog that only ever names Bubble
    // would pass the scenario and cover nothing.
    assert.ok(!st.watch.message.includes(CURSOR_SEAT_NAME), 'a live seat was reported as needing attention');
    assert.deepEqual(
      decideSeatWatch([
        { name: BUBBLE_SEAT_NAME, alive: true },
        { name: CURSOR_SEAT_NAME, alive: false },
      ]).needsAttention,
      [CURSOR_SEAT_NAME]
    );
  });
}

module.exports = { registerSteps };
