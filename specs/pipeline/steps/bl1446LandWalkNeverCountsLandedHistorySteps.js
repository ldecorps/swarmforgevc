'use strict';

// BL-1446: step handlers for "The land walk never counts landed history,
// and a replay carries every hop's work". Drives the REAL
// land_step_lib.bb (land-plan, replay!) through a bb subprocess against a
// fixture git repository with its own origin, built fresh per scenario -
// never a reimplementation of the walk or the replay. Same style as the
// sibling ticket BL-1432's own handler (bl1432LandWalkRangesOverTheParcelSteps.js):
// land-plan is called directly via `bb -e`, not through land_step_cli.bb,
// so the "wide walk forced to origin/main" comparison needs no new CLI
// surface - it is just land-plan's own pre-existing :base override.
//
// Fixture infrastructure (fixture build, land-plan/replay! bb drivers) is
// shared with BL-1447 (same Background text) via
// lib/bl1446LandFixture.js - never a second implementation of either.

const assert = require('node:assert/strict');
const { STAGE_FILES, git, commit, landPlan, replay, buildParcelBranch } = require('./lib/bl1446LandFixture');

const FEATURE = "BL-1446 The land walk never counts landed history, and a replay carries every hop's work";

const KNOWN_SYNCS = new Set([0, 1, 2]);

const FIXTURE_PREFIX = 'bl1446-fixture-';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with an origin, a main branch, and a parcel branch carrying five stage commits for one ticket whose last hop is recorded in the handoff archive$/, (ctx) => {
    buildParcelBranch(ctx, FIXTURE_PREFIX);
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^a sibling ticket's commit lands on origin\/main after the parcel's last hop$/, (ctx) => {
    // An independent line off the ORIGINAL seed (never an ancestor of the
    // parcel's own five stage commits), then origin/main itself advances
    // to it - a real land, not merely a commit sitting somewhere.
    git(ctx.root, 'checkout', '-q', ctx.seed);
    const siblingCommit = commit(ctx.root, 'backlog/active/BL-9002-x.yaml', 'id: BL-9002\n',
      'BL-9002: sibling, will land on origin/main after the hop');
    git(ctx.root, 'update-ref', 'refs/remotes/origin/main', siblingCommit);
    ctx.originMainForced = siblingCommit;
    git(ctx.root, 'checkout', '-q', ctx.documenterTip);
  });

  scoped(/^the parcel branch merges origin\/main$/, (ctx) => {
    git(ctx.root, 'merge', '-q', '--no-ff', '-m', 'Merge origin/main into QA.', 'origin/main');
    ctx.tip = git(ctx.root, 'rev-parse', 'HEAD');
  });

  scoped(/^the land step plans the parcel's tip$/, (ctx) => {
    ctx.plan = landPlan(ctx.root, ctx.tip, 'BL-9001');
  });

  scoped(/^the verdict is LAND_CLEAN$/, (ctx) => {
    assert.equal(ctx.plan.action, 'land', `expected :land (LAND_CLEAN), got: ${JSON.stringify(ctx.plan)}`);
  });

  scoped(/^the wide walk forced to origin\/main gives the same verdict$/, (ctx) => {
    const originMain = git(ctx.root, 'rev-parse', 'refs/remotes/origin/main');
    const wide = landPlan(ctx.root, ctx.tip, 'BL-9001', originMain);
    assert.equal(wide.action, ctx.plan.action,
      `expected the wide walk to agree (${ctx.plan.action}), got: ${JSON.stringify(wide)}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^an unlanded sibling commit sits inside the parcel's own range$/, (ctx) => {
    // Off the SAME seed, but merged DIRECTLY into the parcel branch -
    // never landed on origin/main, which stays at its original position.
    git(ctx.root, 'checkout', '-q', ctx.seed);
    ctx.siblingCommit = commit(ctx.root, 'backlog/active/BL-9002-x.yaml', 'id: BL-9002\n',
      'BL-9002: unlanded sibling inside the parcel\'s own range');
    git(ctx.root, 'checkout', '-q', ctx.documenterTip);
    git(ctx.root, 'merge', '-q', '--no-ff', '-m', 'Merge sibling into QA.', ctx.siblingCommit);
    ctx.documenterTip = git(ctx.root, 'rev-parse', 'HEAD');
  });

  scoped(/^the verdict is LAND_REPLAY$/, (ctx) => {
    assert.equal(ctx.plan.action, 'replay', `expected :replay (LAND_REPLAY), got: ${JSON.stringify(ctx.plan)}`);
    assert.ok(ctx.plan.entangled && ctx.plan.entangled.includes('BL-9002'),
      `expected BL-9002 named as entangled, got: ${JSON.stringify(ctx.plan)}`);
  });

  scoped(/^the replay tip carries every path the five stage commits changed, byte-identical to the cited tip$/, (ctx) => {
    const ownPaths = ctx.plan['own-paths'] || [];
    assert.deepEqual([...ownPaths].sort(), [...STAGE_FILES].sort(),
      `expected own-paths to be exactly the five stage files, got: ${JSON.stringify(ownPaths)}`);
    // BL-1447: land-plan's own :replay already built this exact commit
    // (ctx.plan.commit/.branch) - drop that branch first, since a second
    // replay! call below (this step's own independent verification, by
    // design never trusting land-plan's own build) would otherwise
    // collide on the same deterministic branch name.
    git(ctx.root, 'branch', '-q', '-D', ctx.plan.branch);
    const result = replay(ctx.root, ctx.tip, 'BL-9001', ownPaths, ctx.plan.passengers);
    assert.ok(result.success, `expected replay! to succeed, got: ${JSON.stringify(result)}`);
    for (const p of STAGE_FILES) {
      const citedBlob = git(ctx.root, 'rev-parse', `${ctx.tip}:${p}`);
      const replayedBlob = git(ctx.root, 'rev-parse', `${result.commit}:${p}`);
      assert.equal(replayedBlob, citedBlob,
        `expected ${p} to be byte-identical (same blob) between the replay and the cited tip`);
    }
  });

  // ── Scenario 03 (Outline) ────────────────────────────────────────────
  scoped(/^the parcel branch merges origin\/main (\d+) times after its last hop$/, (ctx, syncsStr) => {
    const syncs = Number(syncsStr);
    if (!KNOWN_SYNCS.has(syncs)) {
      throw new Error(`bl1446: unrecognized <syncs> example value "${syncsStr}"`);
    }
    let tip = ctx.documenterTip;
    for (let n = 0; n < syncs; n += 1) {
      git(ctx.root, 'checkout', '-q', 'origin/main');
      const siblingCommit = commit(ctx.root, `backlog/active/BL-910${n}-x.yaml`, `id: BL-910${n}\n`,
        `BL-910${n}: another sibling landing on origin/main, sync ${n}`);
      git(ctx.root, 'update-ref', 'refs/remotes/origin/main', siblingCommit);
      git(ctx.root, 'checkout', '-q', tip);
      git(ctx.root, 'merge', '-q', '--no-ff', '-m', `Merge origin/main into QA, sync ${n}.`, 'origin/main');
      tip = git(ctx.root, 'rev-parse', 'HEAD');
    }
    ctx.tip = tip;
  });

  scoped(/^the land step plans the parcel's tip with the bounded walk and again with the walk forced to origin\/main$/, (ctx) => {
    const originMain = git(ctx.root, 'rev-parse', 'refs/remotes/origin/main');
    ctx.bounded = landPlan(ctx.root, ctx.tip, 'BL-9001');
    ctx.wide = landPlan(ctx.root, ctx.tip, 'BL-9001', originMain);
  });

  scoped(/^both verdicts are identical$/, (ctx) => {
    assert.equal(ctx.bounded.action, ctx.wide.action,
      `expected the bounded and wide verdicts to agree, got bounded=${JSON.stringify(ctx.bounded)} wide=${JSON.stringify(ctx.wide)}`);
  });

  scoped(/^both own-path sets are identical$/, (ctx) => {
    const boundedPaths = [...(ctx.bounded['own-paths'] || [])].sort();
    const widePaths = [...(ctx.wide['own-paths'] || [])].sort();
    assert.deepEqual(boundedPaths, widePaths,
      `expected the bounded and wide own-path sets to agree, got bounded=${JSON.stringify(boundedPaths)} wide=${JSON.stringify(widePaths)}`);
  });
}

module.exports = { registerSteps };
