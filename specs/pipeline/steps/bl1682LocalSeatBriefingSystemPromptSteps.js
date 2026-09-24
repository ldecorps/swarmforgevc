'use strict';

// BL-1682: step handlers for "The local seat sends the project briefing
// as its system prompt". Drives the REAL runLocalSeatTurn over a real
// mkdtemp scratch target (so the real readLocalSeatSystemPrompt does a
// real fs.readFileSync/trim - never a reimplementation of that logic in
// this handler) with a fake complete/readEndpoint seam - the same
// injection shape BL-1235's/BL-1680's own tests already use.
// localQwenSeatLive/localQwenSeat are lightweight leaf modules (no
// cursor-bridge transitive dependency, unlike telegramCursorBridgeLive) -
// required directly at module scope, same as BL-1680's own handler.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');
const { runLocalSeatTurn } = require('../../../extension/out/tools/localQwenSeatLive');
const { DEFAULT_LOCAL_SEAT_MODEL_ID } = require('../../../extension/out/tools/localQwenSeat');

const FEATURE = 'BL-1682 The local seat sends the project briefing as its system prompt';
const SEAT_TOPIC = 41004;

const KNOWN_BRIEFING_STATES = {
  absent: null,
  'present but whitespace': '   \n\t  ',
};

function briefingPath(root) {
  return path.join(root, 'docs', 'reference', 'local-model-briefing.md');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a local seat fixture over a scratch target whose endpoint is faked and holds the seat's model$/, (ctx) => {
    ctx.root = mkProcessTmpDir('bl1682-briefing-');
  });

  // ── the-briefing-rides-as-the-system-field-01 ──────────────────────────
  scoped(/^the scratch target's docs\/reference\/local-model-briefing\.md holds "(.*)"$/, (ctx, text) => {
    fs.mkdirSync(path.dirname(briefingPath(ctx.root)), { recursive: true });
    fs.writeFileSync(briefingPath(ctx.root), text);
  });

  // ── no-briefing-sends-the-request-the-seat-always-sent-02 ──────────────
  scoped(/^the scratch target's briefing file is (.+)$/, (ctx, raw) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_BRIEFING_STATES, raw)) {
      throw new Error(`bl1682: unrecognized <state> example value "${raw}"`);
    }
    const content = KNOWN_BRIEFING_STATES[raw];
    if (content !== null) {
      fs.mkdirSync(path.dirname(briefingPath(ctx.root)), { recursive: true });
      fs.writeFileSync(briefingPath(ctx.root), content);
    }
    // "absent": leave docs/reference entirely unwritten under the root.
  });

  // ── shared ──────────────────────────────────────────────────────────
  scoped(/^the seat completes a turn for "(.*)"$/, async (ctx, text) => {
    const posted = [];
    let sawSystem;
    let sawPrompt;
    ctx.outcome = await runLocalSeatTurn({
      targetPath: ctx.root,
      topicId: SEAT_TOPIC,
      seatTopicId: SEAT_TOPIC,
      text,
      post: async (topicId, message) => posted.push({ topicId, message }),
      readEndpoint: async () => ({
        probe: { endpointStatus: 'healthy', endpointUrl: 'http://fixture.invalid' },
        catalogue: [DEFAULT_LOCAL_SEAT_MODEL_ID],
      }),
      complete: async (_modelId, prompt, _endpointUrl, system) => {
        sawSystem = system;
        sawPrompt = prompt;
        return 'a reply';
      },
      modelId: DEFAULT_LOCAL_SEAT_MODEL_ID,
    });
    ctx.sawSystem = sawSystem;
    ctx.sawPrompt = sawPrompt;
    ctx.posted = posted;
  });

  scoped(/^the completion request carries system "(.*)"$/, (ctx, expected) => {
    assert.equal(ctx.sawSystem, expected, `expected system "${expected}", got: ${JSON.stringify(ctx.sawSystem)}`);
  });

  scoped(/^the completion request's prompt is exactly "(.*)"$/, (ctx, expected) => {
    assert.equal(ctx.sawPrompt, expected, `expected prompt "${expected}", got: ${JSON.stringify(ctx.sawPrompt)}`);
  });

  scoped(/^the completion request carries no system value$/, (ctx) => {
    assert.equal(ctx.sawSystem, undefined, `expected no system value, got: ${JSON.stringify(ctx.sawSystem)}`);
  });

  scoped(/^the seat's reply is posted in its topic$/, (ctx) => {
    assert.ok(
      ctx.posted.some((p) => p.topicId === SEAT_TOPIC && p.message === 'a reply'),
      `expected the reply posted in topic ${SEAT_TOPIC}, got: ${JSON.stringify(ctx.posted)}`
    );
  });
}

module.exports = { registerSteps };
