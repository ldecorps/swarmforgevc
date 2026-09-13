'use strict';

// BL-1460: step handlers for "an idle /events connection receives one
// snapshot, at connect, however many poll ticks elapse".
//
// Drives a REAL bridge (startBridge) over a throwaway target and reads real
// SSE frames off the real /events route (bl1460IdleEventsFixture's
// connectEvents pumps and classifies every frame as it arrives, so a step
// waits for a frame COUNT instead of guessing a fixed sleep). Scenario 3's
// "no data frame changed" scenarios need no real wait beyond a poll tick or
// two, because broadcastSnapshotIfChanged only re-sends when the serialized
// state actually differs - the fix under test is that the connect path now
// seeds that comparison instead of leaving it undefined.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_POLL_MS,
  DEFAULT_KEEPALIVE_MS,
  makeFixture,
  removeFixture,
  touchActiveItem,
  startFixtureBridge,
  connectEvents,
  sleep,
} = require('./lib/bl1460IdleEventsFixture');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const STANDING_REDS_TSV = path.join(REPO_ROOT, 'backlog', 'standing-reds.tsv');
const BRIDGE_TEST_FILE_REL = 'extension/test/bridgeServer.test.js';

const FEATURE = 'BL-1460 An idle /events connection receives one snapshot, at connect, however many poll ticks elapse';

function state(ctx) {
  if (!ctx.bl1460) ctx.bl1460 = { clients: [] };
  return ctx.bl1460;
}

async function teardown(ctx) {
  const st = state(ctx);
  for (const client of st.clients) {
    await client.close();
  }
  if (st.handle) st.handle.stop();
  removeFixture(st.fx);
  ctx.bl1460 = { clients: [] };
}

async function teardownOnError(ctx, fn) {
  try {
    return await fn();
  } catch (err) {
    await teardown(ctx);
    throw err;
  }
}

async function connectClient(ctx) {
  const st = state(ctx);
  const client = await connectEvents(st.handle);
  await client.waitForCount('data', 1, 5000);
  st.clients.push(client);
  return client;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a fixture target with a bridge started fresh on short poll and keepalive intervals$/, async (ctx) => {
    const st = state(ctx);
    st.fx = makeFixture();
    st.handle = await startFixtureBridge(st.fx);
    st.pollMs = DEFAULT_POLL_MS;
    st.keepaliveMs = DEFAULT_KEEPALIVE_MS;
  });

  // ── Scenario 01 ─────────────────────────────────────────────────────────
  scoped(/^one client connected to \/events and no change to the target$/, async (ctx) => {
    await teardownOnError(ctx, async () => {
      await connectClient(ctx);
    });
  });

  scoped(/^at least three poll ticks have elapsed$/, async (ctx) => {
    await teardownOnError(ctx, async () => {
      const st = state(ctx);
      // Long enough for >=3 poll ticks AND at least one keepalive tick, on
      // both injected intervals - no exact-tick-count dependency: with no
      // target change, `broadcastSnapshotIfChanged` never re-sends however
      // many ticks fire, so this settle only needs to be "long enough".
      await sleep(Math.max(st.pollMs * 4, st.keepaliveMs * 3));
    });
  });

  scoped(/^the client has received exactly one data frame, the connect snapshot$/, async (ctx) => {
    await teardownOnError(ctx, async () => {
      const st = state(ctx);
      const [client] = st.clients;
      assert.equal(client.countOf('data'), 1, `expected exactly one data frame, saw ${client.countOf('data')}`);
      assert.equal(client.frames.find((f) => f.kind === 'data').payload, client.frames[0].payload);
    });
  });

  scoped(/^it has received at least one keepalive comment frame$/, async (ctx) => {
    await teardownOnError(ctx, async () => {
      const st = state(ctx);
      const [client] = st.clients;
      assert.ok(client.countOf('keepalive') >= 1, 'no keepalive comment frame arrived on an otherwise-idle stream');
      await teardown(ctx);
    });
  });

  // ── Scenario 02 ─────────────────────────────────────────────────────────
  scoped(/^one client already connected and at least one poll tick elapsed$/, async (ctx) => {
    await teardownOnError(ctx, async () => {
      const st = state(ctx);
      await connectClient(ctx);
      await sleep(st.pollMs * 1.5);
    });
  });

  scoped(/^a second client connects to \/events and two more poll ticks elapse$/, async (ctx) => {
    await teardownOnError(ctx, async () => {
      const st = state(ctx);
      await connectClient(ctx);
      await sleep(st.pollMs * 2.5);
    });
  });

  scoped(/^the second client's connect snapshot equals the first client's$/, async (ctx) => {
    await teardownOnError(ctx, async () => {
      const st = state(ctx);
      const [first, second] = st.clients;
      assert.equal(second.frames[0].payload, first.frames[0].payload, 'the two clients saw different connect snapshots');
    });
  });

  scoped(/^neither client has received a second data frame$/, async (ctx) => {
    await teardownOnError(ctx, async () => {
      const st = state(ctx);
      const [first, second] = st.clients;
      assert.equal(first.countOf('data'), 1, `first client expected 1 data frame, saw ${first.countOf('data')}`);
      assert.equal(second.countOf('data'), 1, `second client expected 1 data frame, saw ${second.countOf('data')}`);
      await teardown(ctx);
    });
  });

  // ── Scenario 03 ─────────────────────────────────────────────────────────
  scoped(/^two clients connected to \/events and at least one poll tick elapsed$/, async (ctx) => {
    await teardownOnError(ctx, async () => {
      const st = state(ctx);
      await connectClient(ctx);
      await connectClient(ctx);
      await sleep(st.pollMs * 1.5);
    });
  });

  scoped(/^the target's state changes once and two poll ticks elapse$/, async (ctx) => {
    await teardownOnError(ctx, async () => {
      const st = state(ctx);
      st.newTitle = `changed at ${Date.now()}`;
      touchActiveItem(st.fx, st.newTitle);
      for (const client of st.clients) {
        await client.waitForCount('data', 2, 5000);
      }
      // Extra settle past the change tick: proves the SAME change is not
      // re-broadcast on a later, unrelated poll tick.
      await sleep(st.pollMs * 2);
    });
  });

  scoped(/^each client has received exactly one further data frame carrying the change$/, async (ctx) => {
    await teardownOnError(ctx, async () => {
      const st = state(ctx);
      for (const client of st.clients) {
        assert.equal(client.countOf('data'), 2, `expected exactly 2 data frames, saw ${client.countOf('data')}`);
        const changeFrame = client.frames.filter((f) => f.kind === 'data')[1];
        assert.ok(changeFrame.payload.includes(st.newTitle), 'the second data frame does not carry the change');
      }
      await teardown(ctx);
    });
  });

  // ── Scenario 04 ─────────────────────────────────────────────────────────
  scoped(/^the fix is on main$/, (ctx) => {
    ctx.bl1460OnMain = true;
  });

  scoped(new RegExp(`^backlog/standing-reds\\.tsv carries no row for ${BRIDGE_TEST_FILE_REL.replace(/[./]/g, '\\$&')}$`), async (ctx) => {
    // Scenario 04 has no client/bridge steps of its own, but the feature's
    // Background still runs before it (Gherkin backgrounds apply to every
    // scenario in the file) and stands up a fixture bridge nothing else in
    // this scenario ever tears down - left alone that is a permanently
    // leaked listening server, not a slow-to-settle keep-alive socket.
    await teardown(ctx);
    const text = fs.readFileSync(STANDING_REDS_TSV, 'utf8');
    assert.ok(!text.includes(BRIDGE_TEST_FILE_REL), `expected no standing-reds row for ${BRIDGE_TEST_FILE_REL}, got a match`);
  });
}

module.exports = { registerSteps };
