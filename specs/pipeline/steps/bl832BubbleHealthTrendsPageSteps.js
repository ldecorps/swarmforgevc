'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FEATURE =
  "Bubble's Health page reports how the swarm has been working, without inventing a number";
const EXT = path.join(__dirname, '..', '..', '..', 'extension');
const TOKEN = 'bl832-token';
const NOW = Date.parse('2026-02-01T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** Outline fixture pins — kill Gherkin example-cell mutants (BL-908). */
const KNOWN_VALUES = Object.freeze({
  'traverse time': 'traverse time',
  'rework rate': 'rework rate',
  'bottleneck stage': 'bottleneck stage',
  velocity: 'velocity',
});

function pinReadout(name) {
  const pin = KNOWN_VALUES[name];
  if (!pin) {
    throw new Error(`BL-832: unknown Outline readout fixture ${JSON.stringify(name)}`);
  }
  return pin;
}

function loadOut() {
  return {
    startBridge: require(path.join(EXT, 'out', 'bridge', 'bridgeServer')).startBridge,
    buildBubbleHealthTrends: require(path.join(EXT, 'out', 'bridge', 'bubbleHealthCore')).buildBubbleHealthTrends,
    readoutByFeatureName: require(path.join(EXT, 'out', 'bridge', 'bubbleHealthCore')).readoutByFeatureName,
    computeCycleTime: require(path.join(EXT, 'out', 'metrics', 'deliveryMetrics')).computeCycleTime,
    computeVelocity: require(path.join(EXT, 'out', 'metrics', 'deliveryMetrics')).computeVelocity,
    buildBubbleHealthTrendsState: require(path.join(EXT, 'out', 'bridge', 'bridgeState')).buildBubbleHealthTrendsState,
    bubbleHealth: require(path.join(EXT, 'out', 'bridge', 'letsTalkRoutes')).bubbleHealth,
  };
}

function ensure(ctx) {
  if (!ctx.bl832) {
    ctx.bl832 = {
      root: fs.mkdtempSync(path.join(os.tmpdir(), 'bl832-')),
      nowMs: NOW,
      lifecycles: [],
      stageDwell: {
        windowHours: 24,
        windowStartIso: new Date(NOW - 24 * 3600000).toISOString(),
        windowEndIso: new Date(NOW).toISOString(),
        stages: [],
        bottleneck: null,
        unparseableCount: 0,
      },
      reworkRecords: [],
    };
    fs.mkdirSync(path.join(ctx.bl832.root, '.swarmforge', 'operator'), { recursive: true });
  }
  return ctx.bl832;
}

function lifecycle(id, specIso, closeIso) {
  return { ticketId: id, specDateIso: specIso, closeDateIso: closeIso };
}

function deliveryMetricsFrom(ctx) {
  const { computeCycleTime, computeVelocity } = loadOut();
  return {
    cycleTime: computeCycleTime(ctx.lifecycles, ctx.nowMs),
    velocity: computeVelocity(ctx.lifecycles, ctx.nowMs),
  };
}

function emptyDeliveryMetrics(ctx) {
  const { computeCycleTime, computeVelocity } = loadOut();
  return {
    cycleTime: computeCycleTime([], ctx.nowMs),
    velocity: computeVelocity([], ctx.nowMs),
  };
}

function sourceReadoutFor(ctx, readoutName) {
  const libs = loadOut();
  const key = readoutName.trim().toLowerCase();
  const dm = deliveryMetricsFrom(ctx);
  if (key === 'traverse time') {
    return libs.readoutByFeatureName(
      libs.buildBubbleHealthTrends({ ...emptyDeliveryMetrics(ctx), cycleTime: dm.cycleTime }, ctx.stageDwell, [], ctx.nowMs),
      readoutName
    );
  }
  if (key === 'velocity') {
    return libs.readoutByFeatureName(
      libs.buildBubbleHealthTrends({ ...emptyDeliveryMetrics(ctx), velocity: dm.velocity }, ctx.stageDwell, [], ctx.nowMs),
      readoutName
    );
  }
  if (key === 'bottleneck stage') {
    return libs.readoutByFeatureName(
      libs.buildBubbleHealthTrends(emptyDeliveryMetrics(ctx), ctx.stageDwell, [], ctx.nowMs),
      readoutName
    );
  }
  if (key === 'rework rate') {
    return libs.readoutByFeatureName(
      libs.buildBubbleHealthTrends(emptyDeliveryMetrics(ctx), ctx.stageDwell, ctx.reworkRecords, ctx.nowMs),
      readoutName
    );
  }
  throw new Error(`unknown readout "${readoutName}"`);
}

function renderHealth(ctx) {
  const { buildBubbleHealthTrends } = loadOut();
  ctx.health = buildBubbleHealthTrends(deliveryMetricsFrom(ctx), ctx.stageDwell, ctx.reworkRecords, ctx.nowMs);
}

async function withBridge(ctx, fn) {
  const st = ensure(ctx);
  const { startBridge } = loadOut();
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  let handle;
  try {
    handle = await startBridge(st.root, path.join(st.root, 'runs.jsonl'), TOKEN, { nowMs: st.nowMs });
    st.handle = handle;
    return await fn(handle);
  } finally {
    if (handle) {
      handle.stop();
      st.handle = null;
    }
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the swarm has closed tickets within the reported window$/, (ctx) => {
    const st = ensure(ctx);
    st.lifecycles = [
      lifecycle('BL-101', '2026-01-10T00:00:00Z', '2026-01-20T00:00:00Z'),
      lifecycle('BL-102', '2026-01-12T00:00:00Z', '2026-01-25T00:00:00Z'),
    ];
    st.stageDwell.bottleneck = {
      role: 'hardender',
      totalDwellMs: 5000,
      processingDwellMs: 4000,
      multipleOverNext: 1.5,
    };
    st.reworkRecords = [
      {
        ticketId: 'BL-101',
        completedAtMs: NOW - DAY_MS,
        bounced: true,
        bouncedFromRole: 'qa',
        ticketClass: 'medium',
      },
      {
        ticketId: 'BL-102',
        completedAtMs: NOW - DAY_MS,
        bounced: false,
        bouncedFromRole: null,
        ticketClass: 'medium',
      },
    ];
  });

  scoped(/^the Health page is rendered for Bubble$/, (ctx) => {
    renderHealth(ensure(ctx));
  });

  scoped(/^its (.+) equals what the existing computation returns for the same inputs$/, (ctx, readoutName) => {
    const readout = pinReadout(readoutName);
    const { readoutByFeatureName } = loadOut();
    const page = readoutByFeatureName(ctx.bl832.health, readout);
    const source = sourceReadoutFor(ctx.bl832, readout);
    assert.equal(page.displayValue, source.displayValue);
    assert.equal(page.windowLabel, source.windowLabel);
    assert.equal(page.hasObservations, source.hasObservations);
  });

  scoped(/^each readout states the window its own computation used$/, (ctx) => {
    for (const readout of Object.values(ctx.bl832.health)) {
      assert.ok(readout.windowLabel.length > 0);
    }
  });

  scoped(/^no readout claims a window its computation did not use$/, (ctx) => {
    const h = ctx.bl832.health;
    assert.match(h.traverseTime.windowLabel, /last 20 tickets/);
    assert.match(h.velocity.windowLabel, /7-day rolling/);
    assert.match(h.bottleneck.windowLabel, /24h window/);
    assert.match(h.rework.windowLabel, /14-day window/);
  });

  scoped(/^bounces were recorded by more than one bouncing role$/, (ctx) => {
    const st = ensure(ctx);
    st.reworkRecords = [
      {
        ticketId: 'BL-201',
        completedAtMs: NOW - DAY_MS,
        bounced: true,
        bouncedFromRole: 'qa',
        ticketClass: 'low',
      },
      {
        ticketId: 'BL-202',
        completedAtMs: NOW - DAY_MS,
        bounced: true,
        bouncedFromRole: 'architect',
        ticketClass: 'low',
      },
    ];
  });

  scoped(/^the rework readout reports each bouncing role separately$/, (ctx) => {
    renderHealth(ensure(ctx));
    const roles = ctx.bl832.health.rework.byRole.map((row) => row.role).sort();
    assert.deepEqual(roles, ['architect', 'qa']);
  });

  scoped(/^the rework signal has a diagnosed verdict against its baseline$/, (ctx) => {
    const st = ensure(ctx);
    const windowStart = NOW - 14 * DAY_MS;
    const baselineStart = windowStart - 14 * DAY_MS;
    st.reworkRecords = [];
    for (let i = 0; i < 5; i += 1) {
      st.reworkRecords.push({
        ticketId: `BL-B${i}`,
        completedAtMs: baselineStart + (i + 1) * DAY_MS,
        bounced: i === 0,
        bouncedFromRole: i === 0 ? 'qa' : null,
        ticketClass: 'low',
      });
    }
    for (let i = 0; i < 5; i += 1) {
      st.reworkRecords.push({
        ticketId: `BL-W${i}`,
        completedAtMs: windowStart + (i + 1) * DAY_MS,
        bounced: true,
        bouncedFromRole: 'qa',
        ticketClass: 'low',
      });
    }
  });

  scoped(/^that verdict is shown beside the rework count$/, (ctx) => {
    renderHealth(ensure(ctx));
    assert.ok(ctx.bl832.health.rework.hasObservations);
    assert.ok(ctx.bl832.health.rework.directionLine);
    assert.ok(ctx.bl832.health.rework.verdict);
  });

  scoped(/^the window holds no observations for a readout$/, (ctx) => {
    const st = ensure(ctx);
    st.lifecycles = [];
    st.stageDwell.bottleneck = null;
    st.reworkRecords = [];
  });

  scoped(/^that readout states it has no observations$/, (ctx) => {
    renderHealth(ensure(ctx));
    for (const readout of Object.values(ctx.bl832.health)) {
      assert.equal(readout.hasObservations, false);
      assert.equal(readout.displayValue, 'No observations');
    }
  });

  scoped(/^it does not show a zero$/, (ctx) => {
    for (const readout of Object.values(ctx.bl832.health)) {
      assert.notEqual(readout.displayValue, '0');
    }
  });

  scoped(/^the served UI bundle manifest is read$/, async (ctx) => {
    await withBridge(ctx, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/lets-talk/ui-bundle.json`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(res.status, 200);
      ctx.bl832.manifest = await res.json();
    });
  });

  scoped(/^it names the Health page as one of its pages$/, (ctx) => {
    const { bubbleHealth } = loadOut();
    const page = ctx.bl832.manifest.pages.find((entry) => entry.id === bubbleHealth.id);
    assert.ok(page);
    assert.equal(page.title, 'Health');
    assert.equal(page.entryPath, 'health');
  });
}

module.exports = { registerSteps };
