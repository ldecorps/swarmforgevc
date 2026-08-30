'use strict';

// BL-1253 invariant 3, carried verbatim from retired BL-1260 and coder-authored
// per BL-654:
//
//   "At most one process calls getUpdates on a given bot token at any moment:
//    the bridge takes the token only while the front desk is judged not to be
//    polling, never alongside it, and returns it when the front desk recovers."
//
// The first half already has a property: BL-764's
// telegramCursorBridgeCore.property.test.js drives the config decision over
// its whole input space. What that one cannot see is the half this invariant
// adds - "and RETURNS it when the front desk recovers" - because a single
// call cannot exhibit latching. A bridge that took the token and kept it
// would satisfy every one-shot property ever written about the decision and
// still leave the front desk permanently dead, with every liveness signal
// reading green.
//
// So this property drives the REAL runCursorBridgePollOnce over a real
// heartbeat file, across a generated SEQUENCE of polls in one process with
// one deps object. Nothing is restarted between steps, which is the only way
// the hand-back can be observed at all.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { runCursorBridgePollOnce } = require('../out/tools/telegramCursorBridgeLive');
const {
  isFrontDeskInboundFeederLive,
  shouldUseCursorBridgeInboundQueue,
} = require('../out/tools/telegramCursorBridgeCore');
const {
  frontDeskPollHeartbeatPath,
  readFrontDeskPollHeartbeatMs,
  cursorBridgeInboundQueuePath,
  appendCursorBridgeInboundUpdate,
} = require('../out/tools/cursorBridgeInboundQueue');
const { createMockCursorBridgeAgentSession } = require('../out/bridge/cursorBridgeAgentSession');

const STALE_MS = 3_600_000;

/** The four things the feeder file can be, as the bridge finds it on disk. */
const LIVE_STATES = new Set(['fresh']);

function writeHeartbeat(opDir, state) {
  const file = frontDeskPollHeartbeatPath(opDir);
  if (state === 'absent') {
    fs.rmSync(file, { force: true });
    return;
  }
  if (state === 'malformed') {
    fs.writeFileSync(file, '{"lastHeartbeatMs": not-a-number', 'utf8');
    return;
  }
  const lastHeartbeatMs = state === 'fresh' ? Date.now() : Date.now() - STALE_MS;
  fs.writeFileSync(file, JSON.stringify({ lastHeartbeatMs }), 'utf8');
}

/**
 * The landed composition, as telegramCursorBridgeLive's own private
 * resolveInboundQueueFromFeeder composes it. Reproduced rather than imported
 * because exporting it would edit a hotfix source line, which this stamp-off
 * must not do; the acceptance Background pins the two to each other.
 */
function resolveUseInboundQueue(opDir) {
  return shouldUseCursorBridgeInboundQueue(
    { CURSOR_BRIDGE_INBOUND_QUEUE: undefined, CURSOR_BRIDGE_BOT_TOKEN: undefined },
    {
      feederLive: isFrontDeskInboundFeederLive({
        lastHeartbeatMs: readFrontDeskPollHeartbeatMs(opDir),
        nowMs: Date.now(),
      }),
    }
  );
}

/**
 * Runs one sequence of heartbeat states through ONE bridge, and reports what
 * the bridge did at each step: did it call getUpdates (took the token), and
 * did it drain the queue (left the token to the front desk)?
 */
async function runSequence(states) {
  const root = mkTmpDir('bl1253-token-');
  try {
    const opDir = path.join(root, '.swarmforge', 'operator');
    fs.mkdirSync(opDir, { recursive: true });
    const statePath = path.join(opDir, 'cursor-bridge-state.json');
    fs.writeFileSync(statePath, JSON.stringify({ updateOffset: 0, cursorTopicId: 55 }), 'utf8');

    let getUpdatesCalls = 0;
    const deps = {
      repoRoot: root,
      botToken: 'token',
      chatId: '-100',
      principalUserId: '42',
      opDir,
      statePath,
      topicMapPath: path.join(opDir, 'cursor-bridge-topic-map.json'),
      agentSession: createMockCursorBridgeAgentSession(root),
      post: async () => {},
      inboundQueueIdleMs: 1,
      getUpdates: async () => {
        getUpdatesCalls += 1;
        return { success: true, updates: [] };
      },
      resolveUseInboundQueue: () => resolveUseInboundQueue(opDir),
    };

    const observed = [];
    for (let i = 0; i < states.length; i += 1) {
      writeHeartbeat(opDir, states[i]);
      // A queued update the bridge can only consume in queue mode: whether it
      // is still there afterwards is the observable.
      appendCursorBridgeInboundUpdate(opDir, { update_id: 1000 + i });
      const before = getUpdatesCalls;
      // Same deps object every step - nothing restarts between polls.
      await runCursorBridgePollOnce(deps, { updateOffset: 0, cursorTopicId: 55 }, false, 0);
      observed.push({
        state: states[i],
        tookToken: getUpdatesCalls > before,
        drainedQueue: !fs.existsSync(cursorBridgeInboundQueuePath(opDir)),
      });
    }
    return observed;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function checkSequence(observed) {
  for (let i = 0; i < observed.length; i += 1) {
    const { state, tookToken, drainedQueue } = observed[i];
    const feederLive = LIVE_STATES.has(state);

    // "never alongside it": the bridge polls only when the front desk is
    // judged not to be polling.
    assert.equal(
      tookToken,
      !feederLive,
      `step ${i} (${state}): tookToken=${tookToken} with feederLive=${feederLive}`
    );
    // ...and it is genuinely one or the other, never both at once.
    assert.notEqual(
      tookToken && drainedQueue,
      true,
      `step ${i} (${state}): the bridge polled Telegram AND drained the queue`
    );
    assert.equal(
      drainedQueue,
      feederLive,
      `step ${i} (${state}): drainedQueue=${drainedQueue} with feederLive=${feederLive}`
    );

    // "and returns it when the front desk recovers": a recovery step hands
    // the token back, however long the bridge had been holding it. This is
    // the clause that fails against a latching implementation.
    if (i > 0 && feederLive && !LIVE_STATES.has(observed[i - 1].state)) {
      assert.equal(
        tookToken,
        false,
        `step ${i}: the feeder recovered and the bridge kept the token`
      );
    }
  }
}

// ── generators: the transitions are CONSTRUCTED, never hoped for ──────────
//
// A uniform draw over four states puts a long stale run followed by a
// recovery - the shape the invariant is actually about - at a small fraction
// of sequences, and the property would then pass mostly on cases that cannot
// fail. Each case is built to contain the transition it is named for, with
// the uniform draw kept as a separate breadth case underneath.

const DEAD_STATES = ['stale', 'absent', 'malformed'];
const deadArb = fc.constantFrom(...DEAD_STATES);

/** A run of dead observations, then a recovery, then more traffic. */
const recoveryArb = fc
  .tuple(
    fc.array(deadArb, { minLength: 1, maxLength: 3 }),
    fc.array(fc.constantFrom('fresh', ...DEAD_STATES), { minLength: 1, maxLength: 2 })
  )
  .map(([dead, tail]) => [...dead, 'fresh', ...tail]);

/** The mirror: healthy, then the feeder dies mid-run. */
const takeoverArb = fc
  .array(deadArb, { minLength: 1, maxLength: 3 })
  .map((dead) => ['fresh', ...dead]);

/** Repeated hand-offs, so the token changes hands more than once. */
const flappingArb = fc
  .array(fc.constantFrom('fresh', ...DEAD_STATES), { minLength: 4, maxLength: 6 })
  .map((states) => ['fresh', ...states, 'fresh']);

const breadthArb = fc.array(fc.constantFrom('fresh', ...DEAD_STATES), {
  minLength: 1,
  maxLength: 5,
});

const RUNS = 24;

test('property: a recovered front desk always gets the token back, without a restart', async () => {
  await fc.assert(
    fc.asyncProperty(recoveryArb, async (states) => {
      checkSequence(await runSequence(states));
    }),
    { numRuns: RUNS }
  );
});

test('property: the bridge takes the token only when the feeder is judged dead', async () => {
  await fc.assert(
    fc.asyncProperty(takeoverArb, async (states) => {
      checkSequence(await runSequence(states));
    }),
    { numRuns: RUNS }
  );
});

test('property: the token can change hands repeatedly in one process', async () => {
  await fc.assert(
    fc.asyncProperty(flappingArb, async (states) => {
      const observed = await runSequence(states);
      checkSequence(observed);
      // The reach this case exists for, asserted rather than assumed: this
      // sequence really did hand the token over and take it back.
      const handovers = observed.filter(
        (o, i) => i > 0 && o.tookToken !== observed[i - 1].tookToken
      ).length;
      assert.ok(
        handovers >= 1,
        `a flapping sequence produced no handover at all: ${JSON.stringify(observed)}`
      );
    }),
    { numRuns: RUNS }
  );
});

test('property: any sequence of feeder states keeps at most one poller on the token', async () => {
  await fc.assert(
    fc.asyncProperty(breadthArb, async (states) => {
      checkSequence(await runSequence(states));
    }),
    { numRuns: RUNS }
  );
});
