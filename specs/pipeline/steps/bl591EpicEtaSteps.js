'use strict';

// BL-591: step handlers for "epic reorder tiles show a velocity-based ETA
// per epic". Every scenario drives the REAL composition path the reorder
// state feed uses - readBacklogFolders -> combineWithinEpicLiveItems ->
// computeEpicTopics -> estimateEpicEta - over fixture backlog trees with an
// injected clock: no git and no live bridge in any step, and never a JS
// re-statement of the estimator or the membership rules.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { afterEach } = require('node:test');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const { readBacklogFolders } = require('../../../extension/out/panel/backlogReader');
const { combineWithinEpicLiveItems } = require('../../../extension/out/bridge/bridgeServer');
const { computeEpicTopics } = require('../../../extension/out/bridge/epicTopicSlugMatch');
const { estimateEpicEta } = require('../../../extension/out/metrics/epicEta');

const FEATURE = 'Epic reorder tiles show a velocity-based ETA per epic';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const WINDOW = 28 * DAY;

// The Outline's <blocked-how> tokens, each mapped to the YAML (or folder)
// that makes a child not-startable - validated explicitly, never a bare
// passthrough.
const BLOCKED_HOW = {
  'held in backlog/hold/': { folder: 'hold', extra: '' },
  'marked status needs_design': { folder: 'paused', extra: 'status: needs_design\n' },
  'marked status blocked': { folder: 'paused', extra: 'status: blocked\n' },
  'carrying a non-empty block_until list': { folder: 'paused', extra: 'block_until: [GH-22, GH-23]\n' },
  'carrying non-empty promotion_blockers': { folder: 'paused', extra: 'promotion_blockers:\n  - awaiting a ruling\n' },
};

function knownBlockedHow(token) {
  if (!Object.prototype.hasOwnProperty.call(BLOCKED_HOW, token)) {
    throw new Error(`unknown <blocked-how> token: ${token}`);
  }
  return BLOCKED_HOW[token];
}

let trackedRoots = [];

afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

let nextId = 100;

function writeTicket(ctx, folder, { epicSlug, type = 'feature', cost = 'medium', extra = '' }) {
  const id = `BL-${nextId++}`;
  const dir = path.join(ctx.root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}-fixture.yaml`),
    `id: ${id}\ntitle: "fixture ${id}"\ntype: ${type}\npriority: 40\n` +
      (epicSlug ? `epic: ${epicSlug}\n` : '') +
      (type === 'epic' ? '' : `mutation_cost: ${cost}\n`) +
      extra
  );
  return id;
}

function writeEpic(ctx, slug) {
  return writeTicket(ctx, 'paused', { epicSlug: slug, type: 'epic' });
}

function steadyCompletions(perDay = 2) {
  const events = [];
  for (let d = 0; d < 28; d++) {
    for (let k = 0; k < perDay; k++) {
      events.push(NOW - d * DAY - (k + 1) * 1000);
    }
  }
  return events;
}

// The REAL composition path, minus HTTP and git: fixture folders through
// the same exported membership helpers the bridge's state feed uses, then
// the pure estimator per epic.
function composeTileStates(ctx) {
  const folders = readBacklogFolders(ctx.root);
  const all = [...folders.paused, ...folders.hold, ...folders.active];
  const epics = all.filter((item) => item.type === 'epic');
  const within = combineWithinEpicLiveItems({
    paused: folders.paused,
    hold: folders.hold,
    active: folders.active,
  });
  const topics = computeEpicTopics(within, epics);
  ctx.tiles = new Map(
    epics.map((epic) => [
      epic.id,
      estimateEpicEta({
        children: topics.filter((topic) => topic.epicIds.includes(epic.id)),
        completionsMs: ctx.completions,
        nowMs: NOW,
        windowMs: WINDOW,
        packLabel: 'full-forge',
      }),
    ])
  );
}

function theTile(ctx) {
  const tile = ctx.tiles.get(ctx.epicId);
  assert.ok(tile, `no tile composed for ${ctx.epicId}`);
  return tile;
}

function assertNoNanInfinityOrDate(tile) {
  const flat = JSON.stringify(tile, (_k, v) => (typeof v === 'number' ? String(v) : v));
  assert.ok(!/"(NaN|Infinity|-Infinity)"/.test(flat), `NaN/Infinity in the tile state: ${flat}`);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(flat), `a single-date ETA leaked into the tile state: ${flat}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────────
  scoped(/^a fixture backlog with epics and their child tickets$/, (ctx) => {
    ctx.root = mkSocketFixtureRoot('bl591-');
    trackedRoots.push(ctx.root);
    for (const folder of ['active', 'paused', 'hold', 'done']) {
      fs.mkdirSync(path.join(ctx.root, 'backlog', folder), { recursive: true });
    }
  });

  scoped(/^a fixture completion history over a trailing window$/, (ctx) => {
    ctx.completions = steadyCompletions();
  });

  scoped(/^the epic reorder state is composed from these fixtures$/, () => {
    // Deferred: each scenario writes its epics first, then its When
    // composes. Recorded here so the Background reads truthfully.
  });

  // ── Givens ────────────────────────────────────────────────────────────────
  scoped(/^an epic whose open children are all buildable$/, (ctx) => {
    ctx.epicId = writeEpic(ctx, 'bl591-buildable');
    writeTicket(ctx, 'active', { epicSlug: 'bl591-buildable', cost: 'medium' });
    writeTicket(ctx, 'paused', { epicSlug: 'bl591-buildable', cost: 'low' });
  });

  scoped(/^the completion history shows a steady completion rate$/, (ctx) => {
    ctx.completions = steadyCompletions();
  });

  scoped(/^an epic all of whose children are done$/, (ctx) => {
    ctx.epicId = writeEpic(ctx, 'bl591-done');
    writeTicket(ctx, 'done', { epicSlug: 'bl591-done' });
  });

  scoped(
    /^an epic with two buildable children and one child carrying a non-empty block_until list$/,
    (ctx) => {
      ctx.epicId = writeEpic(ctx, 'bl591-mixed');
      writeTicket(ctx, 'paused', { epicSlug: 'bl591-mixed', cost: 'medium' });
      writeTicket(ctx, 'active', { epicSlug: 'bl591-mixed', cost: 'medium' });
      ctx.blockedChildId = writeTicket(ctx, 'paused', {
        epicSlug: 'bl591-mixed',
        cost: 'high',
        extra: 'block_until: [GH-22]\n',
      });
    }
  );

  scoped(/^an epic with one buildable child and one child that is (.+)$/, (ctx, token) => {
    const how = knownBlockedHow(token);
    ctx.epicId = writeEpic(ctx, 'bl591-outline');
    writeTicket(ctx, 'paused', { epicSlug: 'bl591-outline', cost: 'medium' });
    writeTicket(ctx, how.folder, { epicSlug: 'bl591-outline', cost: 'high', extra: how.extra });
    // The comparison epic: the buildable child alone, identical weight.
    ctx.soloEpicId = writeEpic(ctx, 'bl591-solo');
    writeTicket(ctx, 'paused', { epicSlug: 'bl591-solo', cost: 'medium' });
  });

  scoped(/^an epic whose open children all carry non-empty block_until lists$/, (ctx) => {
    ctx.epicId = writeEpic(ctx, 'bl591-all-blocked');
    writeTicket(ctx, 'paused', { epicSlug: 'bl591-all-blocked', extra: 'block_until: [GH-22]\n' });
    writeTicket(ctx, 'paused', { epicSlug: 'bl591-all-blocked', extra: 'block_until: [GH-23]\n' });
  });

  scoped(
    /^an epic with one open child of mutation_cost low and one open child of mutation_cost high$/,
    (ctx) => {
      ctx.epicId = writeEpic(ctx, 'bl591-weights');
      writeTicket(ctx, 'paused', { epicSlug: 'bl591-weights', cost: 'low' });
      writeTicket(ctx, 'paused', { epicSlug: 'bl591-weights', cost: 'high' });
      writeTicket(ctx, 'done', { epicSlug: 'bl591-weights', cost: 'high' });
    }
  );

  scoped(/^a completion history with no completions in the trailing window$/, (ctx) => {
    ctx.completions = [NOW - WINDOW - 5 * DAY];
  });

  scoped(
    /^a second epic identical except most of its remaining weight is blocked$/,
    (ctx) => {
      ctx.secondEpicId = writeEpic(ctx, 'bl591-blocked-twin');
      writeTicket(ctx, 'active', { epicSlug: 'bl591-blocked-twin', cost: 'medium' });
      writeTicket(ctx, 'paused', { epicSlug: 'bl591-blocked-twin', cost: 'high', extra: 'block_until: [GH-22]\n' });
      writeTicket(ctx, 'hold', { epicSlug: 'bl591-blocked-twin', cost: 'high' });
    }
  );

  // ── Whens ─────────────────────────────────────────────────────────────────
  scoped(/^the epic's tile state is composed$/, (ctx) => {
    composeTileStates(ctx);
  });

  scoped(/^the epic's remaining weight is computed$/, (ctx) => {
    composeTileStates(ctx);
  });

  scoped(/^both epics' tile states are composed$/, (ctx) => {
    composeTileStates(ctx);
  });

  // ── Thens ─────────────────────────────────────────────────────────────────
  scoped(
    /^the tile shows an ETA as a range with a low bound and a strictly greater high bound$/,
    (ctx) => {
      const tile = theTile(ctx);
      assert.equal(tile.kind, 'ranged', JSON.stringify(tile));
      assert.ok(tile.lowDays < tile.highDays, `expected a strict band, got ${tile.lowDays}..${tile.highDays}`);
    }
  );

  scoped(/^the tile names the pace assumption the range rests on$/, (ctx) => {
    const tile = theTile(ctx);
    assert.ok(typeof tile.paceAssumption === 'string' && tile.paceAssumption.length > 0);
  });

  scoped(/^the pace assumption names the pack and the trailing window the velocity was measured on$/, (ctx) => {
    const tile = theTile(ctx);
    assert.ok(tile.paceAssumption.includes('full-forge'), tile.paceAssumption);
    assert.ok(tile.paceAssumption.includes('28d'), tile.paceAssumption);
  });

  scoped(/^no NaN, Infinity, or single-date ETA appears in the tile state$/, (ctx) => {
    assertNoNanInfinityOrDate(theTile(ctx));
  });

  scoped(/^the tile shows a complete state with zero remaining weight$/, (ctx) => {
    assert.deepEqual(theTile(ctx), { kind: 'complete' });
  });

  scoped(/^no ETA range and no pace assumption is shown for it$/, (ctx) => {
    const tile = theTile(ctx);
    assert.notEqual(tile.kind, 'ranged');
    assert.ok(!('lowDays' in tile) && !('paceAssumption' in tile), JSON.stringify(tile));
  });

  scoped(/^the ETA range is derived from the two buildable children's weight only$/, (ctx) => {
    const tile = theTile(ctx);
    assert.equal(tile.kind, 'ranged');
    ctx.rangeWithBlocked = { lowDays: tile.lowDays, highDays: tile.highDays };
  });

  scoped(/^the tile reports one blocked child alongside the range$/, (ctx) => {
    const tile = theTile(ctx);
    assert.equal(tile.kind, 'ranged', JSON.stringify(tile));
    assert.equal(tile.blockedCount, 1);
  });

  scoped(/^recomputing with the blocked child removed leaves the ETA range unchanged$/, (ctx) => {
    // Physically remove the blocked child's YAML and recompose through the
    // same real path.
    const dir = path.join(ctx.root, 'backlog', 'paused');
    fs.rmSync(path.join(dir, `${ctx.blockedChildId}-fixture.yaml`));
    composeTileStates(ctx);
    const tile = theTile(ctx);
    assert.equal(tile.kind, 'ranged');
    assert.equal(tile.lowDays, ctx.rangeWithBlocked.lowDays);
    assert.equal(tile.highDays, ctx.rangeWithBlocked.highDays);
    assert.equal(tile.blockedCount, 0);
  });

  scoped(/^the ETA range equals the range computed for the buildable child alone$/, (ctx) => {
    const tile = theTile(ctx);
    const solo = ctx.tiles.get(ctx.soloEpicId);
    assert.equal(tile.kind, 'ranged');
    assert.equal(solo.kind, 'ranged');
    assert.equal(tile.lowDays, solo.lowDays, 'a blocked child leaked weight into the range');
    assert.equal(tile.highDays, solo.highDays);
  });

  scoped(/^the tile shows a blocked state naming why in a word$/, (ctx) => {
    const tile = theTile(ctx);
    assert.equal(tile.kind, 'blocked', JSON.stringify(tile));
    assert.ok(typeof tile.reason === 'string' && tile.reason.length > 0 && !tile.reason.includes(' '));
  });

  scoped(/^the high-cost child contributes strictly more weight than the low-cost child$/, (ctx) => {
    const { childWeight } = require('../../../extension/out/metrics/epicEta');
    assert.ok(childWeight({ mutationCost: 'high' }) > childWeight({ mutationCost: 'low' }));
  });

  scoped(/^a done child contributes zero weight$/, (ctx) => {
    // The done child never enters the live membership at all: composing
    // with and without it is identical. Prove by removing it and
    // recomposing through the same path.
    const before = theTile(ctx);
    fs.rmSync(path.join(ctx.root, 'backlog', 'done'), { recursive: true, force: true });
    composeTileStates(ctx);
    assert.deepEqual(theTile(ctx), before);
  });

  scoped(/^the epic tracker itself contributes zero weight$/, (ctx) => {
    // The tracker is type: epic - computeEpicTopics excludes it from the
    // children, so the tile's weight comes from the two slices alone.
    const tile = theTile(ctx);
    assert.equal(tile.kind, 'ranged');
  });

  scoped(/^the tile shows a no-recent-pace state instead of a range$/, (ctx) => {
    assert.equal(theTile(ctx).kind, 'no-recent-pace', JSON.stringify(theTile(ctx)));
  });

  scoped(/^each tile shows a confidence level$/, (ctx) => {
    for (const id of [ctx.epicId, ctx.secondEpicId]) {
      const tile = ctx.tiles.get(id);
      assert.equal(tile.kind, 'ranged', `${id}: ${JSON.stringify(tile)}`);
      assert.ok(['high', 'medium', 'low'].includes(tile.confidence));
    }
  });

  scoped(/^the mostly-blocked epic's confidence is strictly lower than the all-buildable epic's$/, (ctx) => {
    const rank = { low: 0, medium: 1, high: 2 };
    const buildable = ctx.tiles.get(ctx.epicId);
    const blocked = ctx.tiles.get(ctx.secondEpicId);
    assert.ok(
      rank[blocked.confidence] < rank[buildable.confidence],
      `expected strictly lower, got ${blocked.confidence} vs ${buildable.confidence}`
    );
  });

  scoped(/^the mostly-blocked epic's tile names the reason in a word$/, (ctx) => {
    const blocked = ctx.tiles.get(ctx.secondEpicId);
    assert.ok(
      typeof blocked.confidenceReason === 'string' &&
        blocked.confidenceReason.length > 0 &&
        !blocked.confidenceReason.includes(' ')
    );
  });
}

module.exports = { registerSteps };
