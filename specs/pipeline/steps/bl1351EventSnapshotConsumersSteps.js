'use strict';

// BL-1351: step handlers for "the bridge event snapshot carries only what its
// consumers read".
//
// Every scenario drives the REAL bridge (startBridge) over a throwaway target
// whose backlog holds 1223 items with long description/notes/approval_context
// bodies - the shape that measured 6764293 bytes on 2026-09-02 - and reads
// real frames off the real /events route. The fixture never touches this
// repo's own backlog/: a size gate that moves with the live repo is not a gate.
const assert = require('node:assert/strict');
const {
  ACTIVE_ITEMS,
  DONE_ITEMS,
  PAUSED_ITEMS,
  makeFixture,
  removeFixture,
  touchActiveItem,
  startFixtureBridge,
  connectEvents,
} = require('./lib/bl1351StreamSnapshotFixture');

const FEATURE = 'The bridge event snapshot carries only what its consumers read';

// The budget from the ticket - roughly one thirteenth of today's frame,
// deliberately NOT tuned to whatever this implementation happens to produce.
const BUDGET_BYTES = 512000;

// Scenario Outline cells, validated explicitly rather than passed through.
const KNOWN_TRIGGERS = new Set(['nothing changes', 'one active item changes and the poll loop rebroadcasts']);

// Invariant 1's enumeration, in executable form: the per-item fields the
// consumer sweep in extension/src/bridge/streamSnapshot.ts found any /events
// consumer reading. holisticUiHtml renders `item.id + ' - ' + item.title` and
// joins assignments by `item.id`; no other consumer reads the state frame at
// all (bubbleHostUiHtml takes only host-activity blocks, the reply relay only
// telegram-reply records, and its backlog data comes from disk).
const FIELDS_CONSUMERS_READ = ['id', 'title'];

function state(ctx) {
  if (!ctx.bl1351) ctx.bl1351 = {};
  return ctx.bl1351;
}

async function ensureConnected(ctx) {
  const st = state(ctx);
  if (st.events) return st;
  st.fx = makeFixture();
  st.handle = await startFixtureBridge(st.fx);
  st.events = await connectEvents(st.handle);
  st.connectSnapshot = await st.events.next();
  st.latest = st.connectSnapshot;
  return st;
}

async function rebroadcastAfterChange(ctx) {
  const st = await ensureConnected(ctx);
  const newTitle = `changed at ${Date.now()}`;
  touchActiveItem(st.fx, st.fx.activeIds[0], newTitle);
  // The poll loop re-sends only when the serialized state differs; read until
  // the change is visible rather than assuming the next frame carries it.
  let frame = null;
  for (let attempt = 0; attempt < 6 && !(frame || '').includes(newTitle); attempt += 1) {
    frame = await st.events.next();
  }
  assert.ok(frame && frame.includes(newTitle), 'the poll loop never rebroadcast the changed item');
  st.latest = frame;
  return st;
}

async function teardown(ctx) {
  const st = state(ctx);
  if (st.events) st.events.close();
  if (st.handle) st.handle.stop();
  removeFixture(st.fx);
  ctx.bl1351 = {};
}

// BL-686 hardening precedent (bl687EpicReorderIncludesActiveChildrenSteps.js):
// every step that runs while the bridge may already be live wraps its body
// with this, so a mutated/bad example value throwing anywhere in the
// scenario still closes the server and removes the fixture, rather than
// leaving an open listening socket that hangs the whole node --test process
// (the exact BL-788 hazard - start and stop live in DIFFERENT steps here).
async function teardownOnError(ctx, fn) {
  try {
    return await fn();
  } catch (err) {
    await teardown(ctx);
    throw err;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a target whose backlog holds (\d+) done items, (\d+) paused items and (\d+) active items$/, (ctx, done, paused, active) => {
    assert.equal(Number(done), DONE_ITEMS, 'the feature and the fixture disagree on the done count');
    assert.equal(Number(paused), PAUSED_ITEMS);
    assert.equal(Number(active), ACTIVE_ITEMS);
    state(ctx).sized = true;
  });

  scoped(/^every item carries a long description and long notes$/, (ctx) => {
    // Built into the fixture's ticket YAML - asserted after connect, against
    // what the reader actually parsed, in the field-presence step below.
    state(ctx).fatBodies = true;
  });

  // Deliberately lazy: does NOT connect here. The runtime resolves a step
  // by matching its exact text (runtime.js's registry.resolve, called
  // BEFORE any handler runs) - a mutated Outline trigger cell that no
  // longer matches this feature's "When <trigger>" pattern throws "no step
  // handler matched" from OUTSIDE every handler body, so no per-step
  // try/finally (teardownOnError included) can react to it. If this
  // Background step opened the real bridge eagerly, that failure would
  // leave it open with no later step ever reached to close it - and this
  // fixture's bridge is not cheap to leak: pollIntervalMs:20 makes
  // broadcastSnapshotIfChanged rescan and reserialize all 1223 real
  // backlog items every 20ms, synchronously, for as long as the process
  // runs, pinning the single JS thread and starving every other scenario
  // in the same file. Every step that actually needs the connection
  // (`ensureConnected` inside the "When" handler and the field-presence
  // Then) already calls `ensureConnected(ctx)` itself, memoized - so
  // deferring it here changes no scenario's behavior, and a step-match
  // failure before any of those steps run now leaks nothing at all.
  scoped(/^a client connected to \/events$/, (ctx) => {
    state(ctx).willConnect = true;
  });

  // ── When ─────────────────────────────────────────────────────────────
  scoped(/^(nothing changes|one active item changes and the poll loop rebroadcasts)$/, async (ctx, trigger) => {
    await teardownOnError(ctx, async () => {
      assert.ok(KNOWN_TRIGGERS.has(trigger), `unknown trigger cell: ${trigger}`);
      if (trigger === 'nothing changes') {
        const st = await ensureConnected(ctx);
        st.latest = st.connectSnapshot;
        return;
      }
      await rebroadcastAfterChange(ctx);
    });
  });

  // ── Thens ────────────────────────────────────────────────────────────
  scoped(/^the latest snapshot is under (\d+) bytes$/, async (ctx, budget) => {
    await teardownOnError(ctx, async () => {
      assert.equal(Number(budget), BUDGET_BYTES, 'the feature and the handler disagree on the budget');
      const st = state(ctx);
      const bytes = Buffer.byteLength(st.latest);
      assert.ok(bytes < BUDGET_BYTES, `the snapshot is ${bytes} bytes, over the ${BUDGET_BYTES}-byte budget`);
      // The frame is small because the bodies are gone, not because the fixture
      // is small: every item is still there.
      const parsed = JSON.parse(st.latest);
      assert.equal(parsed.backlog.done.length, DONE_ITEMS, 'the done folder left the stream - that is option 2, not the ruling');
      await teardown(ctx);
    });
  });

  scoped(/^every field the enumerated \/events consumers read is present for every item in the latest snapshot$/, async (ctx) => {
    await teardownOnError(ctx, async () => {
      const st = await ensureConnected(ctx);
      const parsed = JSON.parse(st.latest);
      const folders = Object.keys(parsed.backlog);
      assert.deepEqual(folders.sort(), ['active', 'done', 'hold', 'paused'], 'a backlog folder left the stream');
      for (const folder of folders) {
        for (const item of parsed.backlog[folder]) {
          for (const field of FIELDS_CONSUMERS_READ) {
            assert.ok(
              Object.hasOwn(item, field) && item[field] !== undefined && item[field] !== '',
              `a ${folder} item lost the ${field} its consumer reads: ${JSON.stringify(item)}`,
            );
          }
        }
      }
      // ...and the prose the fixture wrote into every ticket really was on the
      // reader's side of this - so the small frame is a projection, not an
      // empty backlog.
      assert.ok(!st.latest.includes('prose that nothing on the stream ever displays'), 'the item bodies are back on the stream');
      await teardown(ctx);
    });
  });

  scoped(/^the latest snapshot carries the same per-item fields as the connect snapshot$/, async (ctx) => {
    await teardownOnError(ctx, async () => {
      const st = state(ctx);
      const connect = JSON.parse(st.connectSnapshot);
      const latest = JSON.parse(st.latest);
      const shapeOf = (snapshot) =>
        Object.fromEntries(
          Object.entries(snapshot.backlog).map(([folder, items]) => [
            folder,
            [...new Set(items.flatMap((item) => Object.keys(item)))].sort(),
          ]),
        );
      assert.deepEqual(shapeOf(latest), shapeOf(connect), 'a client can observe a field only one producer emits');
      assert.deepEqual(shapeOf(latest).active, FIELDS_CONSUMERS_READ.slice().sort());
      await teardown(ctx);
    });
  });
}

module.exports = { registerSteps };
