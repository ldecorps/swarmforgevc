'use strict';

// BL-1235 acceptance: a local qwen seat answers in its own dedicated topic and
// leaves cursor alone.
//
// Every scenario drives the REAL decision (`decideLocalSeatTurn`) and the REAL
// cursor-bridge scope check, over the topic map's actual shape. Scenario 02 in
// particular is asserted from BOTH sides - the local seat says nothing, AND
// the cursor bridge still owns that surface - because "the local seat did not
// answer" and "somebody still did" are different claims and the human's
// directive needs both.

const assert = require('node:assert/strict');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(REPO_ROOT, 'extension', 'out', 'tools');
const {
  QWEN_LOCAL_SUBJECT_ID,
  DEFAULT_LOCAL_SEAT_MODEL_ID,
  resolveLocalSeatModelId,
  qwenLocalTopicIdFromMap,
  decideLocalSeatTurn,
  formatLocalSeatRefusal,
} = require(path.join(OUT, 'localQwenSeat'));
const {
  CURSOR_BRIDGE_SUBJECT_ID,
  BUBBLE_SUBJECT_ID,
  cursorBridgeTopicIdFromMap,
  bubbleTopicIdFromMap,
  isOwnedCursorBridgeTopic,
} = require(path.join(OUT, 'telegramCursorBridgeCore'));

const FEATURE_NAME = 'a local qwen seat answers in its own dedicated topic, leaving cursor alone';

// The live map's shape plus the binding the human named: t.me/c/4415865297/41004.
const CURSOR_TOPIC = 8435;
const FRONT_DESK_TOPIC = 11810;
const SEAT_TOPIC = 41004;
const TOPIC_MAP = {
  [CURSOR_TOPIC]: CURSOR_BRIDGE_SUBJECT_ID,
  [FRONT_DESK_TOPIC]: BUBBLE_SUBJECT_ID,
  [SEAT_TOPIC]: QWEN_LOCAL_SUBJECT_ID,
};

// Scenario Outline placeholders, validated against known values.
const OTHER_SURFACES = {
  'usual host topic': { topicId: CURSOR_TOPIC, boundTo: CURSOR_BRIDGE_SUBJECT_ID },
  'front desk topic': { topicId: FRONT_DESK_TOPIC, boundTo: BUBBLE_SUBJECT_ID },
};

const ENDPOINT = 'http://127.0.0.1:11434';

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^a dedicated messaging topic reserved for the local model seat$/, (ctx) => {
    ctx.bl1235 = { topicMap: TOPIC_MAP };
    ctx.bl1235.seatTopicId = qwenLocalTopicIdFromMap(TOPIC_MAP);
    assert.equal(ctx.bl1235.seatTopicId, SEAT_TOPIC, 'the seat resolves no dedicated topic of its own');
    // ...and it is a SIBLING, not a replacement: cursor's two surfaces still
    // resolve from the same map.
    assert.equal(cursorBridgeTopicIdFromMap(TOPIC_MAP), CURSOR_TOPIC);
    assert.equal(bubbleTopicIdFromMap(TOPIC_MAP), FRONT_DESK_TOPIC);
  });

  scoped(/^a named local model configured for that seat$/, (ctx) => {
    ctx.bl1235.modelId = resolveLocalSeatModelId({});
    assert.ok(ctx.bl1235.modelId, 'the seat has no configured model');
    assert.equal(ctx.bl1235.modelId, DEFAULT_LOCAL_SEAT_MODEL_ID);
    // The endpoint holds it unless a scenario says otherwise.
    ctx.bl1235.catalogue = [ctx.bl1235.modelId, 'qwen2.5-coder:7b-instruct'];
    ctx.bl1235.probe = { endpointStatus: 'healthy', endpointUrl: ENDPOINT };
  });

  // ── 01 ────────────────────────────────────────────────────────────────
  scoped(/^the local model endpoint is serving that model$/, (ctx) => {
    ctx.bl1235.probe = { endpointStatus: 'healthy', endpointUrl: ENDPOINT };
    assert.ok(ctx.bl1235.catalogue.includes(ctx.bl1235.modelId));
  });

  scoped(/^a message arrives in the dedicated topic$/, (ctx) => {
    ctx.bl1235.arrivedIn = ctx.bl1235.seatTopicId;
    ctx.bl1235.turn = decideLocalSeatTurn({
      topicId: ctx.bl1235.arrivedIn,
      seatTopicId: ctx.bl1235.seatTopicId,
      probe: ctx.bl1235.probe,
      modelId: ctx.bl1235.modelId,
      catalogue: ctx.bl1235.catalogue,
    });
  });

  scoped(/^the reply is produced by the local model$/, (ctx) => {
    assert.equal(ctx.bl1235.turn.kind, 'answer', JSON.stringify(ctx.bl1235.turn));
    assert.equal(ctx.bl1235.turn.modelId, ctx.bl1235.modelId);
    assert.equal(ctx.bl1235.turn.endpointUrl, ENDPOINT, 'the reply did not come from the local endpoint');
  });

  scoped(/^the reply is posted back into that same topic$/, (ctx) => {
    // The seat's decision names no topic of its own: the caller replies where
    // the message came from, and the decision is only reached when that IS the
    // seat's topic. Asserting the identity is what pins "same topic".
    assert.equal(ctx.bl1235.arrivedIn, ctx.bl1235.seatTopicId);
    assert.notEqual(ctx.bl1235.arrivedIn, CURSOR_TOPIC);
    assert.notEqual(ctx.bl1235.arrivedIn, FRONT_DESK_TOPIC);
  });

  // ── 02 ────────────────────────────────────────────────────────────────
  scoped(/^a message arrives in the (usual host topic|front desk topic)$/, (ctx, surface) => {
    const known = OTHER_SURFACES[surface];
    assert.ok(known, `unknown other_surface example value "${surface}"`);
    ctx.bl1235.surface = known;
    ctx.bl1235.turn = decideLocalSeatTurn({
      topicId: known.topicId,
      seatTopicId: ctx.bl1235.seatTopicId,
      probe: ctx.bl1235.probe,
      modelId: ctx.bl1235.modelId,
      catalogue: ctx.bl1235.catalogue,
    });
  });

  scoped(/^the local model seat does not answer it$/, (ctx) => {
    assert.deepEqual(ctx.bl1235.turn, { kind: 'not-mine' }, 'the local seat took a turn on a surface that is not its own');
  });

  scoped(/^that surface is served by the host agent it was already bound to$/, (ctx) => {
    const { topicId, boundTo } = ctx.bl1235.surface;
    // Still bound in the map...
    assert.equal(ctx.bl1235.topicMap[topicId], boundTo, 'the surface lost its existing binding');
    // ...and still inside the cursor bridge's own scope, which is what makes
    // it answer there. The seat's topic is deliberately NOT in that scope.
    const scope = { cursorTopicId: CURSOR_TOPIC, bubbleTopicId: FRONT_DESK_TOPIC };
    assert.equal(isOwnedCursorBridgeTopic(topicId, scope), true, `${boundTo} no longer owns its own surface`);
    assert.equal(isOwnedCursorBridgeTopic(SEAT_TOPIC, scope), false, "the seat's topic was swept into cursor's scope");
  });

  // ── 03 ────────────────────────────────────────────────────────────────
  scoped(/^the local model endpoint is unreachable$/, (ctx) => {
    ctx.bl1235.probe = {
      endpointStatus: 'missing',
      endpointUrl: ENDPOINT,
      reason: 'connect ECONNREFUSED 127.0.0.1:11434',
    };
  });

  scoped(/^the topic carries the endpoint's actual failure reason$/, (ctx) => {
    assert.equal(ctx.bl1235.turn.kind, 'refuse', JSON.stringify(ctx.bl1235.turn));
    ctx.bl1235.posted = formatLocalSeatRefusal(ctx.bl1235.turn);
    assert.ok(
      ctx.bl1235.posted.includes('ECONNREFUSED'),
      `the endpoint's own reason did not reach the topic: ${ctx.bl1235.posted}`
    );
  });

  scoped(/^the reply is not a bare status code or a silent drop$/, (ctx) => {
    const posted = ctx.bl1235.posted;
    assert.ok(posted && posted.trim(), 'the topic got nothing at all');
    assert.ok(!/^\s*\d+\s*$/.test(posted), `the topic got a bare status code: ${posted}`);
    assert.ok(posted.includes(ENDPOINT), 'the refusal does not say which endpoint');
    assert.match(posted, /No other seat has been asked/);
  });

  // ── 04 ────────────────────────────────────────────────────────────────
  scoped(/^the endpoint is up but does not hold that model$/, (ctx) => {
    ctx.bl1235.probe = { endpointStatus: 'healthy', endpointUrl: ENDPOINT };
    ctx.bl1235.catalogue = ['qwen2.5-coder:7b-instruct'];
    assert.ok(!ctx.bl1235.catalogue.includes(ctx.bl1235.modelId), 'the fixture still holds the configured model');
  });

  scoped(/^the topic names the configured model as unavailable$/, (ctx) => {
    assert.equal(ctx.bl1235.turn.kind, 'refuse', JSON.stringify(ctx.bl1235.turn));
    ctx.bl1235.posted = formatLocalSeatRefusal(ctx.bl1235.turn);
    assert.ok(
      ctx.bl1235.posted.includes(ctx.bl1235.modelId),
      `the refusal does not name ${ctx.bl1235.modelId}: ${ctx.bl1235.posted}`
    );
    assert.match(ctx.bl1235.posted, /does not hold/);
  });

  scoped(/^no other seat is asked to answer in its place$/, (ctx) => {
    // Structural, not a promise: the decision type offers no fallback or
    // delegate case, so there is nothing for a caller to route on.
    assert.ok(['answer', 'refuse', 'not-mine'].includes(ctx.bl1235.turn.kind));
    assert.equal(ctx.bl1235.turn.kind, 'refuse');
    assert.match(ctx.bl1235.posted, /No other seat has been asked/);
    // ...and cursor's scope is unchanged, so nothing there picks it up either.
    assert.equal(
      isOwnedCursorBridgeTopic(SEAT_TOPIC, { cursorTopicId: CURSOR_TOPIC, bubbleTopicId: FRONT_DESK_TOPIC }),
      false
    );
  });
}

module.exports = { registerSteps };
