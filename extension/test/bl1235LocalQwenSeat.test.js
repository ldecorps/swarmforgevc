'use strict';

// BL-1235: a local qwen seat answers in its own dedicated topic, leaving
// cursor's host topic and the front desk untouched.
//
// The human directive, verbatim: "cursor stays behind the usual host topic and
// front desk. I want local qwen only behind its dedicated one." These tests
// are mostly about the second half of that sentence being enforceable rather
// than merely intended.

const assert = require('node:assert/strict');
const {
  QWEN_LOCAL_SUBJECT_ID,
  DEFAULT_LOCAL_SEAT_MODEL_ID,
  LOCAL_SEAT_MODEL_ENV,
  LOCAL_SEAT_SLOW_TURN_NOTICE,
  resolveLocalSeatModelId,
  qwenLocalTopicIdFromMap,
  decideLocalSeatTurn,
  formatLocalSeatRefusal,
  formatLocalSeatAcknowledgement,
} = require('../out/tools/localQwenSeat');
const {
  CURSOR_BRIDGE_SUBJECT_ID,
  BUBBLE_SUBJECT_ID,
  QWEN_LOCAL_SUBJECT_ID: BRIDGE_QWEN_SUBJECT_ID,
  cursorBridgeTopicIdFromMap,
  bubbleTopicIdFromMap,
  isOwnedCursorBridgeTopic,
} = require('../out/tools/telegramCursorBridgeCore');

// The live map's shape, plus the new binding: chat 4415865297, topic 41004.
const TOPIC_MAP = { 8435: CURSOR_BRIDGE_SUBJECT_ID, 11810: BUBBLE_SUBJECT_ID, 41004: QWEN_LOCAL_SUBJECT_ID };
const SEAT_TOPIC = 41004;
const HEALTHY = { endpointStatus: 'healthy', endpointUrl: 'http://127.0.0.1:11434' };
const DOWN = { endpointStatus: 'missing', endpointUrl: 'http://127.0.0.1:11434', reason: 'connection refused' };
const CATALOGUE = ['qwen3:14b', 'qwen2.5-coder:7b-instruct'];

const turn = (over = {}) =>
  decideLocalSeatTurn({
    topicId: SEAT_TOPIC,
    seatTopicId: SEAT_TOPIC,
    probe: HEALTHY,
    modelId: DEFAULT_LOCAL_SEAT_MODEL_ID,
    catalogue: CATALOGUE,
    ...over,
  });

describe('BL-1235 the seat is a third subject in the existing map', () => {
  it('is named in the module that resolves a topic to a seat', () => {
    assert.equal(BRIDGE_QWEN_SUBJECT_ID, QWEN_LOCAL_SUBJECT_ID);
  });

  it('resolves its own topic alongside cursor and bubble', () => {
    assert.equal(qwenLocalTopicIdFromMap(TOPIC_MAP), SEAT_TOPIC);
    assert.equal(cursorBridgeTopicIdFromMap(TOPIC_MAP), 8435);
    assert.equal(bubbleTopicIdFromMap(TOPIC_MAP), 11810);
  });

  it('has no topic when the map does not bind one', () => {
    assert.equal(qwenLocalTopicIdFromMap({ 8435: CURSOR_BRIDGE_SUBJECT_ID }), undefined);
  });
});

describe("BL-1235 invariant 1: cursor's surfaces are never served by this seat", () => {
  for (const [name, topicId] of [
    ['the usual host topic', 8435],
    ['the front desk topic', 11810],
    ['some other topic entirely', 999],
  ]) {
    it(`says nothing at all on ${name}`, () => {
      assert.deepEqual(turn({ topicId }), { kind: 'not-mine' });
    });
  }

  it('says nothing even when the endpoint is down - it is not asked, so it does not decline', () => {
    // A seat that answered "I am broken" on cursor's topic would be answering
    // on cursor's topic. Not-mine outranks every other condition.
    assert.deepEqual(turn({ topicId: 8435, probe: DOWN, catalogue: [] }), { kind: 'not-mine' });
  });

  it('is kept out of the cursor bridge own topic scope', () => {
    // The structural half: decideInboundGate ignores anything outside this
    // bag, so leaving the seat's topic out of it is what stops cursor
    // answering there.
    assert.equal(isOwnedCursorBridgeTopic(SEAT_TOPIC, { cursorTopicId: 8435, bubbleTopicId: 11810 }), false);
    assert.equal(isOwnedCursorBridgeTopic(8435, { cursorTopicId: 8435, bubbleTopicId: 11810 }), true);
  });

  it('says nothing when it has no topic of its own bound yet', () => {
    assert.deepEqual(turn({ seatTopicId: undefined }), { kind: 'not-mine' });
  });
});

describe('BL-1235 a message in the dedicated topic is answered by the local model', () => {
  it('answers with the configured model', () => {
    assert.deepEqual(turn(), {
      kind: 'answer',
      modelId: DEFAULT_LOCAL_SEAT_MODEL_ID,
      endpointUrl: 'http://127.0.0.1:11434',
    });
  });
});

describe('BL-1235 invariant 2: a seat that cannot answer says why, in its own topic', () => {
  it('carries the endpoint own reason when it is unreachable', () => {
    const decision = turn({ probe: DOWN });

    assert.equal(decision.kind, 'refuse');
    assert.match(decision.reason, /connection refused/);
    const posted = formatLocalSeatRefusal(decision);
    assert.match(posted, /connection refused/);
    assert.match(posted, /No other seat has been asked/);
    // Never a bare status code, and never silence.
    assert.ok(posted.length > 20, posted);
    assert.ok(!/^\d+$/.test(posted.trim()), posted);
  });

  it('names the configured model when the endpoint does not hold it', () => {
    const decision = turn({ modelId: 'qwen3-coder:14b' });

    assert.equal(decision.kind, 'refuse');
    assert.match(decision.reason, /does not hold "qwen3-coder:14b"/);
    // ...and says what it DOES hold, so a wrong tag is one line from a fix.
    assert.match(decision.reason, /qwen3:14b/);
  });

  it('says so when the endpoint holds nothing at all', () => {
    assert.match(turn({ catalogue: [] }).reason, /it holds: nothing/);
  });

  it('refuses when no model is configured, rather than picking one', () => {
    const decision = turn({ modelId: '   ' });
    assert.equal(decision.kind, 'refuse');
    assert.match(decision.reason, /no local model is configured/);
  });

  it('offers the caller nowhere to hand the turn on to', () => {
    // The structural half of "never hands the turn to another seat": the
    // decision type has no fallback or delegate case to route on.
    const kinds = new Set(
      [turn(), turn({ probe: DOWN }), turn({ topicId: 8435 }), turn({ catalogue: [] })].map((d) => d.kind)
    );
    for (const kind of kinds) {
      assert.ok(['answer', 'refuse', 'not-mine'].includes(kind), kind);
    }
  });
});

describe('BL-1235 the model id is configuration, not a constant', () => {
  it('prefers an explicitly configured id', () => {
    assert.equal(resolveLocalSeatModelId({}, 'qwen2.5-coder:7b-instruct'), 'qwen2.5-coder:7b-instruct');
  });

  it('falls back to the environment', () => {
    assert.equal(resolveLocalSeatModelId({ [LOCAL_SEAT_MODEL_ENV]: 'from-env:1b' }), 'from-env:1b');
  });

  it('defaults to the tag the human chose', () => {
    assert.equal(resolveLocalSeatModelId({}), 'qwen3:14b');
    assert.equal(DEFAULT_LOCAL_SEAT_MODEL_ID, 'qwen3:14b');
  });

  it('ignores a blank configured id rather than seating an empty model', () => {
    assert.equal(resolveLocalSeatModelId({ [LOCAL_SEAT_MODEL_ENV]: '  ' }, '  '), DEFAULT_LOCAL_SEAT_MODEL_ID);
  });
});

describe('BL-1235 the slow-turn acknowledgement', () => {
  it('names the model and warns the reply takes minutes on this host', () => {
    // Measured on this host: 3m19s for a 2046-token prompt, ~2.8 tok/s,
    // CPU-only. Without a first word the topic looks dead.
    const ack = formatLocalSeatAcknowledgement('qwen3:14b');
    assert.match(ack, /qwen3:14b/);
    assert.match(ack, /minutes/);
    assert.ok(ack.includes(LOCAL_SEAT_SLOW_TURN_NOTICE));
  });
});
