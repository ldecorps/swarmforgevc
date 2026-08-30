'use strict';

// BL-1235's two declared invariants, coder-authored (BL-654), property lane
// only.
//
// Invariant 1 - "The local seat answers only in its own dedicated topic -
// cursor's host topic and the front desk are never served by it."
//
//   This is a human directive quoted verbatim in the ticket, so it is stated
//   as an IMPLICATION over every input the seat can be handed: if the decision
//   is `answer`, the message arrived in the seat's own topic. Stated that way
//   round it cannot be satisfied by a filter someone remembers to apply - any
//   path that answers has to have come through the topic check.
//
//   Reach is by construction over the SURFACES that exist rather than over
//   random integers: cursor's host topic, the front desk, the seat's own, an
//   unrelated topic, and no topic at all, each with its own floor. A uniform
//   integer draw would hit the two surfaces the directive actually names
//   almost never, and those are the whole point.
//
// Invariant 2 - "A seat that cannot answer says why in its own topic; it never
// fails silently and never hands the turn to another seat."
//
//   Three separate claims, so three assertions per draw: the refusal is
//   non-empty and is not a bare status code (never silent), it carries the
//   endpoint's OWN reason rather than a generic one (says why), and the
//   decision type offers no case a caller could route elsewhere on (never
//   hands the turn on).
//
//   Every draw is a REFUSAL by construction - the cause is drawn from the three
//   real ones - because a uniform draw would spend most runs on the healthy
//   path, where this invariant says nothing at all.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { assertReachFloor } = require('./helpers/reachFloors');
const {
  QWEN_LOCAL_SUBJECT_ID,
  DEFAULT_LOCAL_SEAT_MODEL_ID,
  decideLocalSeatTurn,
  formatLocalSeatRefusal,
} = require('../out/tools/localQwenSeat');
const {
  CURSOR_BRIDGE_SUBJECT_ID,
  BUBBLE_SUBJECT_ID,
  isOwnedCursorBridgeTopic,
} = require('../out/tools/telegramCursorBridgeCore');

const CURSOR_TOPIC = 8435;
const FRONT_DESK_TOPIC = 11810;
const SEAT_TOPIC = 41004;
const ENDPOINT = 'http://127.0.0.1:11434';

const SURFACES = {
  cursorHostTopic: CURSOR_TOPIC,
  frontDeskTopic: FRONT_DESK_TOPIC,
  seatOwnTopic: SEAT_TOPIC,
  unrelatedTopic: 77777,
  noTopicAtAll: undefined,
};
const SURFACE_FLOOR = 20;

// Every endpoint/model state the seat can meet, healthy and otherwise, so
// invariant 1 is checked across all of them rather than only the happy one.
const endpointArb = fc.oneof(
  fc.constant({ probe: { endpointStatus: 'healthy', endpointUrl: ENDPOINT }, catalogue: [DEFAULT_LOCAL_SEAT_MODEL_ID] }),
  fc.constant({ probe: { endpointStatus: 'healthy', endpointUrl: ENDPOINT }, catalogue: [] }),
  fc.constant({
    probe: { endpointStatus: 'missing', endpointUrl: ENDPOINT, reason: 'connect ECONNREFUSED 127.0.0.1:11434' },
    catalogue: [DEFAULT_LOCAL_SEAT_MODEL_ID],
  }),
  fc.constant({
    probe: { endpointStatus: 'unhealthy', endpointUrl: ENDPOINT, reason: 'model runner exited' },
    catalogue: [DEFAULT_LOCAL_SEAT_MODEL_ID],
  })
);

describe("BL-1235 invariant 1: the seat answers only in its own topic", () => {
  it('answers only when the message arrived in the seat own topic', () => {
    const coverage = {};
    for (const [name, topicId] of Object.entries(SURFACES)) {
      fc.assert(
        fc.property(endpointArb, fc.string(), ({ probe, catalogue }, noise) => {
          coverage[name] = (coverage[name] || 0) + 1;
          const decision = decideLocalSeatTurn({
            topicId,
            seatTopicId: SEAT_TOPIC,
            probe,
            modelId: DEFAULT_LOCAL_SEAT_MODEL_ID,
            catalogue,
          });

          if (decision.kind === 'answer') {
            assert.equal(topicId, SEAT_TOPIC, `the seat answered on ${name}`);
          }
          // ...and on the two surfaces the human named, it does not so much as
          // decline: it is not asked.
          if (topicId === CURSOR_TOPIC || topicId === FRONT_DESK_TOPIC) {
            coverage.cursorSurface = (coverage.cursorSurface || 0) + 1;
            assert.deepEqual(decision, { kind: 'not-mine' }, `the seat took a turn on ${name}`);
          }
          void noise;
          return true;
        }),
        { numRuns: SURFACE_FLOOR }
      );
    }
    assertReachFloor(coverage, Object.keys(SURFACES), SURFACE_FLOOR, 'surface');
    assertReachFloor(coverage, ['cursorSurface'], SURFACE_FLOOR * 2, "draws on cursor's own surfaces");
  });

  it('never lets the seat topic into the cursor bridge own scope', () => {
    fc.assert(
      fc.property(fc.constantFrom(...Object.values(SURFACES)), (topicId) => {
        const scope = { cursorTopicId: CURSOR_TOPIC, bubbleTopicId: FRONT_DESK_TOPIC };
        if (topicId === SEAT_TOPIC) {
          assert.equal(isOwnedCursorBridgeTopic(topicId, scope), false, "cursor claimed the seat's topic");
        }
        if (topicId === CURSOR_TOPIC || topicId === FRONT_DESK_TOPIC) {
          assert.equal(isOwnedCursorBridgeTopic(topicId, scope), true, 'cursor lost one of its own surfaces');
        }
        return true;
      }),
      { numRuns: 40 }
    );
  });

  it('keeps the three subjects distinct', () => {
    assert.equal(new Set([CURSOR_BRIDGE_SUBJECT_ID, BUBBLE_SUBJECT_ID, QWEN_LOCAL_SUBJECT_ID]).size, 3);
  });
});

// Every cause the seat can refuse for, each built so the refusal is certain.
const REFUSAL_CAUSES = {
  endpointDown: () => ({
    probe: { endpointStatus: 'missing', endpointUrl: ENDPOINT, reason: 'connect ECONNREFUSED 127.0.0.1:11434' },
    modelId: DEFAULT_LOCAL_SEAT_MODEL_ID,
    catalogue: [DEFAULT_LOCAL_SEAT_MODEL_ID],
    expectInReason: 'ECONNREFUSED',
  }),
  endpointUnhealthy: () => ({
    probe: { endpointStatus: 'unhealthy', endpointUrl: ENDPOINT, reason: 'model runner exited' },
    modelId: DEFAULT_LOCAL_SEAT_MODEL_ID,
    catalogue: [DEFAULT_LOCAL_SEAT_MODEL_ID],
    expectInReason: 'model runner exited',
  }),
  modelAbsent: () => ({
    probe: { endpointStatus: 'healthy', endpointUrl: ENDPOINT },
    modelId: 'qwen3-coder:14b',
    catalogue: ['qwen2.5-coder:7b-instruct'],
    expectInReason: 'qwen3-coder:14b',
  }),
  noModelConfigured: () => ({
    probe: { endpointStatus: 'healthy', endpointUrl: ENDPOINT },
    modelId: '   ',
    catalogue: [DEFAULT_LOCAL_SEAT_MODEL_ID],
    expectInReason: 'no local model is configured',
  }),
};
const CAUSE_FLOOR = 15;

describe('BL-1235 invariant 2: a seat that cannot answer says why, and hands the turn to nobody', () => {
  it('posts a reason that is neither silence nor a bare status code', () => {
    const coverage = {};
    for (const [name, build] of Object.entries(REFUSAL_CAUSES)) {
      fc.assert(
        fc.property(fc.constant(name), (cause) => {
          coverage[cause] = (coverage[cause] || 0) + 1;
          const { probe, modelId, catalogue, expectInReason } = build();

          const decision = decideLocalSeatTurn({
            topicId: SEAT_TOPIC,
            seatTopicId: SEAT_TOPIC,
            probe,
            modelId,
            catalogue,
          });

          assert.equal(decision.kind, 'refuse', `${cause} did not refuse: ${JSON.stringify(decision)}`);

          const posted = formatLocalSeatRefusal(decision);
          // Never silent.
          assert.ok(posted && posted.trim().length > 0, `${cause} posted nothing`);
          // Never a bare status code.
          assert.ok(!/^\s*\d+\s*$/.test(posted), `${cause} posted a bare status code: ${posted}`);
          // Says WHY - the endpoint's own words, not a generic stand-in.
          assert.ok(posted.includes(expectInReason), `${cause} lost its reason: ${posted}`);
          assert.ok(posted.includes(ENDPOINT), `${cause} does not say which endpoint: ${posted}`);
          // Hands the turn to nobody, and says so.
          assert.match(posted, /No other seat has been asked/);
          return true;
        }),
        { numRuns: CAUSE_FLOOR }
      );
    }
    assertReachFloor(coverage, Object.keys(REFUSAL_CAUSES), CAUSE_FLOOR, 'refusal cause');
  });

  // Each of the three kinds is CONSTRUCTED, one fc.assert apiece, rather than
  // hoped for from a uniform draw. The first version of this test drew topic,
  // endpoint and model independently and asked for all three kinds afterwards:
  // an `answer` needed all three draws to land on their one matching value at
  // once, P = 1/5 x 1/4 x 1/3 = 1/60, so over 120 runs P(zero answers) was
  // ~13% - a one-in-eight flake, found by the architect running it six times.
  // That is the same under-provisioned-reach defect this repo has now hit in
  // three separate property tests; the fix is always to build the case, never
  // to raise numRuns until the lottery usually wins.
  const KIND_CASES = {
    answer: {
      topicId: SEAT_TOPIC,
      probe: { endpointStatus: 'healthy', endpointUrl: ENDPOINT },
      modelId: DEFAULT_LOCAL_SEAT_MODEL_ID,
      catalogue: [DEFAULT_LOCAL_SEAT_MODEL_ID],
    },
    refuse: {
      topicId: SEAT_TOPIC,
      probe: { endpointStatus: 'missing', endpointUrl: ENDPOINT, reason: 'connect ECONNREFUSED' },
      modelId: DEFAULT_LOCAL_SEAT_MODEL_ID,
      catalogue: [DEFAULT_LOCAL_SEAT_MODEL_ID],
    },
    'not-mine': {
      topicId: CURSOR_TOPIC,
      probe: { endpointStatus: 'healthy', endpointUrl: ENDPOINT },
      modelId: DEFAULT_LOCAL_SEAT_MODEL_ID,
      catalogue: [DEFAULT_LOCAL_SEAT_MODEL_ID],
    },
  };
  const KIND_FLOOR = 10;

  it('offers no decision a caller could route to another seat on', () => {
    const coverage = {};
    for (const [expected, input] of Object.entries(KIND_CASES)) {
      fc.assert(
        fc.property(fc.constant(expected), (kind) => {
          const decision = decideLocalSeatTurn({ ...input, seatTopicId: SEAT_TOPIC });
          coverage[decision.kind] = (coverage[decision.kind] || 0) + 1;
          assert.equal(decision.kind, kind, `the constructed ${kind} case produced ${decision.kind}`);
          // The structural half of "never hands the turn to another seat":
          // there is no fallback, delegate or escalate case to route on.
          assert.ok(
            ['answer', 'refuse', 'not-mine'].includes(decision.kind),
            `the seat produced a routable decision kind: ${decision.kind}`
          );
          return true;
        }),
        { numRuns: KIND_FLOOR }
      );
    }
    // Deterministic now: each kind was built, so the floor cannot miss.
    assertReachFloor(coverage, Object.keys(KIND_CASES), KIND_FLOOR, 'decision kind');
  });

  it('still produces only the three kinds under an arbitrary draw', () => {
    // The breadth half, kept - but with no reach floor on it, because breadth
    // is what this one is for and coverage is what the constructed test above
    // owns.
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.values(SURFACES)),
        endpointArb,
        fc.constantFrom(DEFAULT_LOCAL_SEAT_MODEL_ID, 'absent:1b', '  '),
        (topicId, { probe, catalogue }, modelId) => {
          const decision = decideLocalSeatTurn({ topicId, seatTopicId: SEAT_TOPIC, probe, modelId, catalogue });
          assert.ok(
            ['answer', 'refuse', 'not-mine'].includes(decision.kind),
            `the seat produced a routable decision kind: ${decision.kind}`
          );
          return true;
        }
      ),
      { numRuns: 120 }
    );
  });
});
