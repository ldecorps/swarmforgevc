'use strict';

// BL-1680's declared invariant (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   "No acceptance handler or unit test reaches resolveLocalSeatModelId
//    with the live process.env: every caller of the real
//    runLocalSeatTurn pins modelId or the SWARMFORGE_LOCAL_SEAT_MODEL
//    seam."
//
// Drives the REAL runLocalSeatTurn (extension/out/tools/localQwenSeatLive)
// with the SAME injection shape BL-1384's own (fixed) acceptance handler
// now uses - a pinned modelId beside a faked catalogue holding that same
// id - across a generated matrix of SWARMFORGE_LOCAL_SEAT_MODEL values
// the live process.env happens to hold, asserting the resolved/requested
// model is ALWAYS the pinned one, never the env value: the exact
// behaviour the pin exists to guarantee, whatever the host exports.
//
// GENERATOR REACH (reached by construction, never by draw). The env value
// space needs BOTH shapes exercised: the env var ABSENT entirely (the
// pre-BL-1680-incident default state) and PRESENT naming a model the
// fixture's own catalogue does NOT hold (the live-host shape that made
// BL-1384's feature red) - a generator that only ever left it unset would
// never reach the actual regression.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { runLocalSeatTurn } = require('../out/tools/localQwenSeatLive');
const { DEFAULT_LOCAL_SEAT_MODEL_ID } = require('../out/tools/localQwenSeat');

const ENV_KEY = 'SWARMFORGE_LOCAL_SEAT_MODEL';

const FOREIGN_MODEL_POOL = ['qwen2.5-coder:latest', 'llama3.1:8b', 'mistral:7b', 'gpt-oss:20b'];

function withEnv(value, fn) {
  const previous = process.env[ENV_KEY];
  if (value === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = previous;
    }
  }
}

test('BL-1680/BL-654 invariant: a caller that pins modelId beside its faked catalogue always gets the pinned model, whatever SWARMFORGE_LOCAL_SEAT_MODEL the live host exports', async () => {
  const shapes = ['unset', ...FOREIGN_MODEL_POOL];
  const reach = Object.fromEntries(shapes.map((s) => [s, 0]));

  for (const shape of shapes) {
    await fc.assert(
      fc.asyncProperty(fc.constant(shape), async () => {
        reach[shape] += 1;
        const requested = [];
        const posts = [];
        const envValue = shape === 'unset' ? undefined : shape;
        const outcome = await withEnv(envValue, () =>
          runLocalSeatTurn({
            targetPath: '/dev/null',
            topicId: 4242,
            seatTopicId: 4242,
            text: 'hello',
            post: async (topicId, message) => {
              posts.push({ topicId, message });
            },
            modelId: DEFAULT_LOCAL_SEAT_MODEL_ID,
            readEndpoint: async () => ({
              probe: { endpointStatus: 'healthy', endpointUrl: 'http://fixture.invalid' },
              catalogue: [DEFAULT_LOCAL_SEAT_MODEL_ID],
            }),
            complete: async (modelId) => {
              requested.push(modelId);
              return 'ok';
            },
          }),
        );

        assert.equal(outcome.kind, 'answer', `expected an answer for env=${JSON.stringify(shape)}, got: ${JSON.stringify(outcome)}`);
        assert.deepEqual(
          requested,
          [DEFAULT_LOCAL_SEAT_MODEL_ID],
          `expected the pinned model requested for env=${JSON.stringify(shape)}, got: ${JSON.stringify(requested)}`,
        );
        assert.ok(
          !posts.some((p) => /does not hold/.test(p.message)),
          `expected no does-not-hold refusal for env=${JSON.stringify(shape)}, got: ${JSON.stringify(posts)}`,
        );
        return true;
      }),
      { numRuns: 1 },
    );
  }

  for (const shape of shapes) {
    if (reach[shape] < 1) {
      throw new Error(`reach floor: env-value shape ${shape} never drawn`);
    }
  }
});
