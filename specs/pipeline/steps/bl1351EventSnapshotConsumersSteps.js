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

  scoped(/^a client connected to \/events$/, async (ctx) => {
    await ensureConnected(ctx);
  });

  // ── When ─────────────────────────────────────────────────────────────
  scoped(/^(nothing changes|one active item changes and the poll loop rebroadcasts)$/, async (ctx, trigger) => {
    assert.ok(KNOWN_TRIGGERS.has(trigger), `unknown trigger cell: ${trigger}`);
    if (trigger === 'nothing changes') {
      const st = await ensureConnected(ctx);
      st.latest = st.connectSnapshot;
      return;
    }
    await rebroadcastAfterChange(ctx);
  });

  // ── Thens ────────────────────────────────────────────────────────────
  scoped(/^the latest snapshot is under (\d+) bytes$/, async (ctx, budget) => {
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

  scoped(/^every field the enumerated \/events consumers read is present for every item in the latest snapshot$/, async (ctx) => {
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

  scoped(/^the latest snapshot carries the same per-item fields as the connect snapshot$/, async (ctx) => {
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
}

module.exports = { registerSteps };
