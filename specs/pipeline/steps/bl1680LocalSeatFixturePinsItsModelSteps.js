'use strict';

// BL-1680: step handlers for "The local seat fixture pins the model it
// fakes". Scenario 01 drives the REAL BL-1384 feature through the REAL
// acceptance runner, in a child process so this scenario controls
// SWARMFORGE_LOCAL_SEAT_MODEL without leaking it into the parent's own env
// (or any other running test). Scenario 02 drives the REAL runLocalSeatTurn
// directly, with the SAME injection shape BL-1384's own handler now uses
// (a pinned modelId beside a faked catalogue holding that same id) - never
// a reimplementation of either the front-desk/bridge machinery or the
// turn's own decision logic.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runLocalSeatTurn } = require('../../../extension/out/tools/localQwenSeatLive');
const { DEFAULT_LOCAL_SEAT_MODEL_ID } = require('../../../extension/out/tools/localQwenSeat');

const FEATURE = 'BL-1680 The local seat fixture pins the model it fakes';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'specs', 'pipeline', 'cli.js');
const BL1384_FEATURE = path.join(
  REPO_ROOT,
  'specs',
  'features',
  'BL-1384-the-local-seat-topic-reaches-the-bridge-through-the-front-desk.feature',
);

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario Outline 01 ──────────────────────────────────────────────
  scoped(/^a child process whose SWARMFORGE_LOCAL_SEAT_MODEL is (.+)$/, (ctx, value) => {
    ctx.envValue = value === 'unset' ? undefined : value;
  });

  scoped(/^it runs BL-1384's feature through the acceptance runner$/, (ctx) => {
    const env = { ...process.env };
    if (ctx.envValue === undefined) {
      delete env.SWARMFORGE_LOCAL_SEAT_MODEL;
    } else {
      env.SWARMFORGE_LOCAL_SEAT_MODEL = ctx.envValue;
    }
    const result = spawnSync('node', [CLI, BL1384_FEATURE], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
      timeout: 60000,
    });
    ctx.childResult = result;
  });

  scoped(/^every scenario of that feature passes$/, (ctx) => {
    const { status, stdout, stderr } = ctx.childResult;
    assert.equal(status, 0, `expected BL-1384's feature to pass, got exit ${status}:\n${stdout}${stderr}`);
    assert.match(stdout, /# fail 0/, `expected 0 failures, got:\n${stdout}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^SWARMFORGE_LOCAL_SEAT_MODEL names a model the BL-1384 fixture catalogue does not hold$/, (ctx) => {
    ctx.previousEnv = process.env.SWARMFORGE_LOCAL_SEAT_MODEL;
    process.env.SWARMFORGE_LOCAL_SEAT_MODEL = 'qwen2.5-coder:latest';
    assert.notEqual(
      process.env.SWARMFORGE_LOCAL_SEAT_MODEL,
      DEFAULT_LOCAL_SEAT_MODEL_ID,
      'the fixture ticket assumes the env value differs from the pinned catalogue model',
    );
  });

  scoped(/^the BL-1384 fixture drains one forwarded message$/, async (ctx) => {
    const requestedModelIds = [];
    const posts = [];
    try {
      const outcome = await runLocalSeatTurn({
        targetPath: '/dev/null',
        topicId: 4242,
        seatTopicId: 4242,
        text: 'hello',
        post: async (topicId, message) => {
          posts.push({ topicId, message });
        },
        // The exact shape BL-1384's own (fixed) handler now uses: modelId
        // pinned beside a catalogue holding that same id.
        modelId: DEFAULT_LOCAL_SEAT_MODEL_ID,
        readEndpoint: async () => ({
          probe: { endpointStatus: 'healthy', endpointUrl: 'http://fixture.invalid' },
          catalogue: [DEFAULT_LOCAL_SEAT_MODEL_ID],
        }),
        complete: async (modelId) => {
          requestedModelIds.push(modelId);
          return 'Hello from qwen';
        },
      });
      ctx.turnOutcome = outcome;
      ctx.requestedModelIds = requestedModelIds;
      ctx.posts = posts;
    } finally {
      if (ctx.previousEnv === undefined) {
        delete process.env.SWARMFORGE_LOCAL_SEAT_MODEL;
      } else {
        process.env.SWARMFORGE_LOCAL_SEAT_MODEL = ctx.previousEnv;
      }
    }
  });

  scoped(/^the completion is requested for the catalogue's own model$/, (ctx) => {
    assert.deepEqual(
      ctx.requestedModelIds,
      [DEFAULT_LOCAL_SEAT_MODEL_ID],
      `expected the completion requested for ${DEFAULT_LOCAL_SEAT_MODEL_ID}, got: ${JSON.stringify(ctx.requestedModelIds)}`,
    );
  });

  scoped(/^the seat's reply is posted in the local seat topic, not a does-not-hold refusal$/, (ctx) => {
    assert.equal(ctx.turnOutcome.kind, 'answer', `expected an answer, got: ${JSON.stringify(ctx.turnOutcome)}`);
    assert.ok(
      ctx.posts.some((p) => p.topicId === 4242 && p.message === 'Hello from qwen'),
      `expected the reply posted in topic 4242, got: ${JSON.stringify(ctx.posts)}`,
    );
    assert.ok(
      !ctx.posts.some((p) => /does not hold/.test(p.message)),
      `expected no does-not-hold refusal, got: ${JSON.stringify(ctx.posts)}`,
    );
  });
}

module.exports = { registerSteps };
