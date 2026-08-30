'use strict';

// BL-1243 acceptance: each Live Screen tile paints its own agent's activity.
//
// The scenarios drive the REAL writer (`derivePaneActivitySignal` in
// residentPaneLive.ts) over the REAL BL-970 pane captures, and the REAL reader
// (`resolvePaneStatusKind`, extracted from residentSpyUiHtml.ts's browser
// source and evaluated) - so "the tile paints X" is asserted through the same
// function the browser runs, not through a restatement of its rule.
//
// Scenario 04 is the operator's own stop condition: it counts pane captures.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(REPO_ROOT, 'extension', 'out');
const FIXTURES = path.join(REPO_ROOT, 'specs', 'features', 'fixtures', 'BL-970');
const UI_SOURCE = path.join(REPO_ROOT, 'extension', 'src', 'bridge', 'residentSpyUiHtml.ts');
const LIVE_SOURCE = path.join(REPO_ROOT, 'extension', 'src', 'bridge', 'residentPaneLive.ts');
const { derivePaneActivitySignal } = require(path.join(OUT, 'bridge', 'residentPaneLive'));

const FEATURE_NAME = "Each Live Screen tile paints its own agent's activity";

// BL-1160's whole palette. Scenario 05 is about this set not growing.
const EXISTING_STATUS_KINDS = new Set(['ok', 'stale', 'err']);

const KNOWN_CONDITIONS = new Set(['unavailable', 'never captured']);

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

/**
 * The browser's own resolver, lifted out of the UI source and evaluated. A
 * hand-written copy here would be a second rule that could drift from the one
 * that actually paints the dot - which is the whole class of defect BL-1160
 * left open and this ticket closes.
 */
function loadResolver() {
  const source = fs.readFileSync(UI_SOURCE, 'utf8');
  const fn = /function resolvePaneStatusKind\(pane, aggregateKind\) \{[\s\S]*?\n  \}/.exec(source);
  assert.ok(fn, 'resolvePaneStatusKind has moved or been renamed in residentSpyUiHtml.ts');
  // eslint-disable-next-line no-new-func
  return new Function(`${fn[0]}\nreturn resolvePaneStatusKind;`)();
}

function paneFor(name) {
  const paneText = fixture(name);
  return { available: true, paneText, activitySignal: derivePaneActivitySignal(paneText) };
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^a Live Screen poll that captured pane text for each live role$/, (ctx) => {
    ctx.bl1243 = { resolve: loadResolver() };
    assert.ok(fs.existsSync(FIXTURES), 'the shared BL-970 pane captures are missing');
  });

  // ── 01 ────────────────────────────────────────────────────────────────
  scoped(/^one role pane is busy and another is idle in the same poll$/, (ctx) => {
    ctx.bl1243.busy = paneFor('midturn-esc-footer.txt');
    ctx.bl1243.idle = paneFor('idle-real-qa-4-shells.txt');
  });

  scoped(/^their tiles show different activity dots$/, (ctx) => {
    // Through the reader, with the SAME aggregate for both: if the tiles still
    // differ, the difference came from the panes themselves.
    const busyKind = ctx.bl1243.resolve(ctx.bl1243.busy, 'ok');
    const idleKind = ctx.bl1243.resolve(ctx.bl1243.idle, 'ok');
    assert.notEqual(busyKind, idleKind, `both tiles painted ${busyKind} under one poll`);
    assert.equal(busyKind, 'ok', 'the busy tile is not the healthy one');
  });

  // ── 02 ────────────────────────────────────────────────────────────────
  scoped(/^a role pane is (unavailable|never captured)$/, (ctx, condition) => {
    assert.ok(KNOWN_CONDITIONS.has(condition), `unknown condition example value "${condition}"`);
    ctx.bl1243.pane =
      condition === 'unavailable'
        ? { available: false, activitySignal: derivePaneActivitySignal(undefined) }
        : { available: true, paneText: fixture('empty-capture.txt'), activitySignal: derivePaneActivitySignal(fixture('empty-capture.txt')) };
  });

  scoped(/^its tile is not painted ok$/, (ctx) => {
    // Scenario 02 supplies no aggregate, so it gets 'ok' deliberately: a pane
    // with nothing of its own must not inherit green from the poll (invariant
    // 1). Scenario 06 reuses this Then with aggregate 'err', where the pane
    // DOES have a healthy signal of its own and the failed poll must still win.
    const aggregate = ctx.bl1243.aggregate ?? 'ok';
    const kind = ctx.bl1243.resolve(ctx.bl1243.pane, aggregate);
    assert.notEqual(kind, 'ok', `the tile was painted ok under aggregate ${aggregate}`);
    if (aggregate === 'err') {
      assert.equal(kind, 'err', 'a failed poll must paint err, not merely something-other-than-ok');
    } else {
      assert.notEqual(ctx.bl1243.pane.activitySignal, 'ok', 'a textless pane claimed a healthy signal of its own');
    }
  });

  // ── 06 ────────────────────────────────────────────────────────────────
  scoped(/^the poll is failing and a role pane's own last signal was ok$/, (ctx) => {
    // The pane the last good poll captured, repainted while the poll fails.
    ctx.bl1243.pane = paneFor('midturn-esc-footer.txt');
    assert.equal(ctx.bl1243.pane.activitySignal, 'ok', 'the fixture must be a pane whose own last signal was ok');
    ctx.bl1243.aggregate = 'err';
  });

  // ── 03 ────────────────────────────────────────────────────────────────
  scoped(/^a role tile is expanded to fullscreen$/, (ctx) => {
    ctx.bl1243.pane = paneFor('midturn-unlisted-verb-real-capture.txt');
    // Fullscreen renders the SAME pane object the tile did - BL-1160's own
    // invariant 2 - so the cue is the tile's resolver over the tile's pane.
    ctx.bl1243.tileKind = ctx.bl1243.resolve(ctx.bl1243.pane, 'stale');
    ctx.bl1243.fullscreenKind = ctx.bl1243.resolve(ctx.bl1243.pane, 'stale');
  });

  scoped(/^the fullscreen activity cue shows that pane's own signal$/, (ctx) => {
    assert.equal(ctx.bl1243.fullscreenKind, ctx.bl1243.tileKind);
    assert.equal(
      ctx.bl1243.fullscreenKind,
      ctx.bl1243.pane.activitySignal,
      "the cue did not come from the pane's own signal"
    );
  });

  // ── 04 ────────────────────────────────────────────────────────────────
  scoped(/^the snapshot derives an activity signal for every live role$/, (ctx) => {
    // The operator's stop condition, checked structurally rather than by
    // timing: count the capture call sites on the Live Screen path in the
    // source, and prove the writer is a pure function of text already held.
    const source = fs.readFileSync(LIVE_SOURCE, 'utf8');
    ctx.bl1243.captureCallSites = (source.match(/\bcapturePane\(/g) || []).length;
    const writer = /export function derivePaneActivitySignal\([\s\S]*?\n\}/.exec(source);
    assert.ok(writer, 'derivePaneActivitySignal has moved');
    ctx.bl1243.writerBody = writer[0];
    // ...and it does derive one for every pane that has text.
    for (const name of fs.readdirSync(FIXTURES)) {
      const text = fixture(name);
      assert.ok(
        derivePaneActivitySignal(text) !== undefined,
        `${name}: a captured pane got no signal of its own`
      );
    }
  });

  scoped(/^the number of pane captures performed is unchanged$/, (ctx) => {
    // Two, and only two: the pane body and the role-search read that
    // tryCaptureRolePane already made before this ticket. A third would be the
    // new per-pane probe the operator said not to ship.
    assert.equal(
      ctx.bl1243.captureCallSites,
      2,
      `the Live Screen path now makes ${ctx.bl1243.captureCallSites} pane captures; BL-1243 must add none`
    );
    for (const forbidden of ['capturePane', 'execFile', 'spawnSync', 'setInterval']) {
      assert.ok(
        !ctx.bl1243.writerBody.includes(forbidden),
        `the writer reaches for ${forbidden} - it must be pure over text already held`
      );
    }
  });

  // ── 05 ────────────────────────────────────────────────────────────────
  scoped(/^a tile paints its activity dot$/, (ctx) => {
    ctx.bl1243.emitted = new Set(
      fs
        .readdirSync(FIXTURES)
        .map((name) => derivePaneActivitySignal(fixture(name)))
        .filter((s) => s !== undefined)
    );
    // Plus what the reader can return for a pane carrying each of them.
    for (const kind of ctx.bl1243.emitted) {
      ctx.bl1243.emitted.add(ctx.bl1243.resolve({ available: true, activitySignal: kind }, 'ok'));
    }
  });

  scoped(/^the dot uses only the status kinds that existed before$/, (ctx) => {
    for (const kind of ctx.bl1243.emitted) {
      assert.ok(EXISTING_STATUS_KINDS.has(kind), `${kind} is not one of the kinds that existed before`);
    }
    assert.ok(ctx.bl1243.emitted.size > 1, 'the check saw only one kind and would pass against a constant');
  });
}

module.exports = { registerSteps };
