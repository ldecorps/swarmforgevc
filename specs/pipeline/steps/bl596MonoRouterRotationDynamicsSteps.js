'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'mono-router rotation dynamics emit a trended telemetry series';
const REPO = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'rotation_telemetry_lib.bb');

function loadStore() {
  return require(path.join(REPO, 'extension', 'out', 'metrics', 'rotationDynamicsStore'));
}

function loadPure() {
  return require(path.join(REPO, 'extension', 'out', 'metrics', 'rotationDynamics'));
}

function ensure(ctx) {
  if (!ctx.bl596) ctx.bl596 = {};
  return ctx.bl596;
}

function freshRoot(ctx) {
  const st = ensure(ctx);
  if (!st.root) {
    st.root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl596-aps-'));
    fs.mkdirSync(path.join(st.root, '.swarmforge'), { recursive: true });
  }
  return st.root;
}

async function idle() {
  await loadStore().whenRotationTelemetryIdle();
}

function appendViaBb(root, event) {
  const atMs = event['at-ms'];
  const reason = event.reason.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const expr = [
    `(load-file ${JSON.stringify(LIB)})`,
    `(rotation-telemetry-lib/append-rotation-event! ${JSON.stringify(root)} {:from "${event.from}" :to "${event.to}" :reason "${reason}"${atMs != null ? ` :at-ms ${atMs}` : ''}})`,
  ].join('\n');
  const res = spawnSync('bb', ['-e', expr], { cwd: REPO, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr || res.stdout);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a mono-router pack with a single rotating resident$/, (ctx) => {
    freshRoot(ctx);
    ensure(ctx).monoRouter = true;
  });

  scoped(/^the resident rotates from one persona to another with a recorded reason$/, async (ctx) => {
    const st = ensure(ctx);
    const root = freshRoot(ctx);
    st.before = loadStore().readRotationEvents(root).length;
    appendViaBb(root, {
      from: 'coder',
      to: 'cleaner',
      reason: 'handoff-forward',
      'at-ms': Date.parse('2026-08-27T10:00:00.000Z'),
    });
    await idle();
  });

  scoped(/^exactly one event is appended to the rotation telemetry log$/, (ctx) => {
    const st = ensure(ctx);
    const events = loadStore().readRotationEvents(st.root);
    assert.equal(events.length, st.before + 1);
    st.last = events[events.length - 1];
  });

  scoped(/^the event carries from-role to-role reason and timestamp fields$/, (ctx) => {
    const ev = ensure(ctx).last;
    assert.equal(ev.from, 'coder');
    assert.equal(ev.to, 'cleaner');
    assert.equal(ev.reason, 'handoff-forward');
    assert.ok(ev.at);
  });

  scoped(/^a fixture stream of rotation events over a time window$/, (ctx) => {
    const st = ensure(ctx);
    st.events = [
      { at: '2026-08-27T10:00:00.000Z', from: 'coder', to: 'cleaner', reason: 'handoff-forward' },
      { at: '2026-08-27T11:00:00.000Z', from: 'cleaner', to: 'coder', reason: 'rotate-home' },
    ];
    st.window = {
      startMs: Date.parse('2026-08-27T09:00:00.000Z'),
      endMs: Date.parse('2026-08-27T12:00:00.000Z'),
      homeRole: 'coder',
    };
  });

  scoped(/^the rotation dynamics aggregator runs without filesystem access$/, (ctx) => {
    const st = ensure(ctx);
    st.agg = loadPure().aggregateRotationDynamics(st.events, st.window);
  });

  scoped(/^it reports per-persona dwell shares for that window$/, (ctx) => {
    const shares = ensure(ctx).agg.dwellShares;
    assert.ok(shares.cleaner > 0);
    assert.ok(shares.coder > 0);
  });

  scoped(/^it reports rotations per day and cumulative time stranded off-home$/, (ctx) => {
    const agg = ensure(ctx).agg;
    assert.ok(agg.rotationsPerDay > 0);
    assert.equal(agg.strandedOffHomeMs, 60 * 60 * 1000);
  });

  scoped(
    /^rotation events that flip back to the prior persona within the thrash window$/,
    (ctx) => {
      ensure(ctx).thrashEvents = [
        { at: '2026-08-27T10:00:00.000Z', from: 'coder', to: 'cleaner', reason: 'chase' },
        { at: '2026-08-27T10:00:05.000Z', from: 'cleaner', to: 'coder', reason: 'chase' },
      ];
    }
  );

  scoped(/^rotation events that are ordinary persona changes$/, (ctx) => {
    ensure(ctx).ordinaryEvents = [
      { at: '2026-08-27T10:00:00.000Z', from: 'coder', to: 'cleaner', reason: 'handoff-forward' },
      { at: '2026-08-27T10:30:00.000Z', from: 'cleaner', to: 'architect', reason: 'handoff-forward' },
    ];
  });

  scoped(/^the rotation dynamics aggregator runs$/, (ctx) => {
    const st = ensure(ctx);
    const window = {
      startMs: Date.parse('2026-08-27T09:00:00.000Z'),
      endMs: Date.parse('2026-08-27T12:00:00.000Z'),
      homeRole: 'coder',
      thrashWindowMs: 30_000,
    };
    st.thrashAgg = loadPure().aggregateRotationDynamics(st.thrashEvents, window);
    st.ordinaryAgg = loadPure().aggregateRotationDynamics(st.ordinaryEvents, window);
  });

  scoped(/^thrash rotations are counted distinctly from non-thrash rotations$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.thrashAgg.thrashRotations, 1);
    assert.equal(st.thrashAgg.ordinaryRotations, 1);
    assert.equal(st.ordinaryAgg.thrashRotations, 0);
    assert.equal(st.ordinaryAgg.ordinaryRotations, 2);
  });

  scoped(/^an active pack that is not a mono-router rotation model$/, (ctx) => {
    ensure(ctx).monoRouter = false;
  });

  scoped(/^rotation dynamics telemetry is queried$/, (ctx) => {
    const st = ensure(ctx);
    st.query = loadPure().queryRotationDynamics([], {
      startMs: 0,
      endMs: 1,
      homeRole: 'coder',
    }, st.monoRouter);
  });

  scoped(/^the series is empty or marked not applicable$/, (ctx) => {
    assert.equal(ensure(ctx).query.applicable, false);
    assert.equal(ensure(ctx).query.aggregate, null);
  });

  scoped(/^no error is raised$/, () => {
    assert.doesNotThrow(() => {
      loadPure().queryRotationDynamics([], { startMs: 0, endMs: 1, homeRole: 'coder' }, false);
    });
  });
}

module.exports = { registerSteps };
