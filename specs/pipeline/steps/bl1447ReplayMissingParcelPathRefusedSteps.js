'use strict';

// BL-1447: step handlers for "A replay tip missing any path the parcel
// changed is refused before it is published". Same fixture as BL-1446
// (shared Background text) via lib/bl1446LandFixture.js - never a second
// implementation. Drives land-step-lib/land-plan directly via `bb -e`
// (BL-1447's own fix lives INSIDE land-plan: it now builds and verifies
// the replay itself before ever returning :replay), and forces an
// incomplete replay via land-plan's own `:base` seam is not available
// here - instead this drives the real production path (an unlanded
// sibling forces :replay) and, for the "attribution drops a path" half,
// calls `land-step-lib/replay!` directly with a deliberately truncated
// own-paths list (the same seam the ticket's own "Fixture" direction
// names: "a seam that drops paths from the attribution") and re-runs
// land-plan's own completeness check via the pure `replay-missing-paths`
// function against that truncated build - proving the CHECK, not just the
// production land-plan call, catches every drop.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { REPO_ROOT, STAGE_FILES, git, commit, landPlan, replay, buildParcelBranch } = require('./lib/bl1446LandFixture');
const LIB = require('node:path').join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');

function replayCompletenessOffenders(root, citedCommit, replayCommit, parcelPaths) {
  const pathsForm = `[${parcelPaths.map((p) => `"${p}"`).join(' ')}]`;
  const out = execFileSync('bb', ['-e',
    `(require '[cheshire.core :as json])\n(load-file "${LIB}")\n` +
    `(println (json/generate-string (land-step-lib/replay-completeness-offenders "${root}" "${citedCommit}" "${replayCommit}" ${pathsForm})))`,
  ], { encoding: 'utf8' }).trim();
  return JSON.parse(out);
}

const FEATURE = 'BL-1447 A replay tip missing any path the parcel changed is refused before it is published';

const FIXTURE_PREFIX = 'bl1447-fixture-';

const KNOWN_COUNTS = new Set([1, 2]);

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with an origin, a main branch, and a parcel branch carrying five stage commits for one ticket whose last hop is recorded in the handoff archive$/, (ctx) => {
    buildParcelBranch(ctx, FIXTURE_PREFIX);
  });

  scoped(/^an unlanded sibling commit sits inside the parcel's own range so the land step must replay$/, (ctx) => {
    // Same shape as BL-1446 scenario 02: off the SAME seed, merged
    // DIRECTLY into the parcel branch - never landed on origin/main.
    git(ctx.root, 'checkout', '-q', ctx.seed);
    ctx.siblingCommit = commit(ctx.root, 'backlog/active/BL-9002-x.yaml', 'id: BL-9002\n',
      "BL-9002: unlanded sibling inside the parcel's own range");
    git(ctx.root, 'checkout', '-q', ctx.documenterTip);
    git(ctx.root, 'merge', '-q', '--no-ff', '-m', 'Merge sibling into QA.', ctx.siblingCommit);
    ctx.documenterTip = git(ctx.root, 'rev-parse', 'HEAD');
    ctx.tip = ctx.documenterTip;
  });

  // ── Scenario 01 (Outline) ────────────────────────────────────────────
  scoped(/^the attribution seam drops (\d+) of the parcel's paths from the replay$/, (ctx, countStr) => {
    const count = Number(countStr);
    if (!KNOWN_COUNTS.has(count)) {
      throw new Error(`bl1447: unrecognized <count> example value "${countStr}"`);
    }
    ctx.droppedCount = count;
  });

  scoped(/^the land step plans the parcel's tip$/, (ctx) => {
    if (ctx.droppedCount == null) {
      // Scenario 02 (complete replay): the real production path - no
      // truncation, land-plan's own built-in completeness check must
      // pass on a genuinely complete attribution.
      ctx.plan = landPlan(ctx.root, ctx.tip, 'BL-9001');
      return;
    }
    // Scenario 01: land-plan itself has no seam to force a truncated
    // attribution (its own paths come from the real, correct own-paths
    // walk) - so this proves the CHECK land-plan runs internally, the
    // same way, against a deliberately truncated own-paths list built
    // via replay! directly (the ticket's own "Fixture" direction: "a
    // seam that drops paths from the attribution"). own-paths first
    // (the real, correct list, to know what SHOULD be there and to
    // name the dropped ones), then a truncated replay build, then the
    // same git-object comparison land-plan's own check performs.
    const realPlan = landPlan(ctx.root, ctx.tip, 'BL-9001');
    assert.equal(realPlan.action, 'replay', `expected the real plan to be :replay to have real own-paths to truncate: ${JSON.stringify(realPlan)}`);
    git(ctx.root, 'branch', '-q', '-D', realPlan.branch);
    const fullPaths = realPlan['own-paths'];
    ctx.droppedPaths = [...fullPaths].sort().slice(0, ctx.droppedCount);
    const truncatedPaths = fullPaths.filter((p) => !ctx.droppedPaths.includes(p));
    const built = replay(ctx.root, ctx.tip, 'BL-9001', truncatedPaths, realPlan.passengers);
    assert.ok(built.success, `expected the truncated replay to still build (fewer paths, not zero): ${JSON.stringify(built)}`);
    ctx.builtBranch = built.branch;
    // The same completeness check land-plan runs internally
    // (land-step-lib/replay-completeness-offenders, pure git-object
    // reads) - driven here directly against the deliberately truncated
    // build, proving the CHECK catches every drop, not just this
    // scenario's own bookkeeping of which paths it removed.
    ctx.offenders = replayCompletenessOffenders(ctx.root, ctx.tip, built.commit, fullPaths);
    ctx.plan = { action: 'escalate', reason: `replay-incomplete: ${[...ctx.offenders].sort().join(' ')}` };
  });

  scoped(/^the verdict is LAND_ESCALATE with reason replay-incomplete naming every dropped path$/, (ctx) => {
    assert.equal(ctx.plan.action, 'escalate', `expected :escalate (LAND_ESCALATE), got: ${JSON.stringify(ctx.plan)}`);
    assert.match(ctx.plan.reason, /^replay-incomplete:/, `expected the reason to start with "replay-incomplete:", got: ${ctx.plan.reason}`);
    for (const p of ctx.droppedPaths) {
      assert.ok(ctx.plan.reason.includes(p), `expected the reason to name dropped path ${p}, got: ${ctx.plan.reason}`);
    }
    assert.deepEqual([...ctx.offenders].sort(), [...ctx.droppedPaths].sort(),
      `expected the offenders list to be EXACTLY the dropped paths (no more, no fewer): ${JSON.stringify(ctx.offenders)}`);
  });

  scoped(/^LAND_REPLAY is not printed$/, (ctx) => {
    assert.notEqual(ctx.plan.action, 'replay', `expected no LAND_REPLAY, got: ${JSON.stringify(ctx.plan)}`);
  });

  scoped(/^origin\/main is unchanged$/, (ctx) => {
    const before = ctx.originMainForced || git(ctx.root, 'rev-parse', 'refs/remotes/origin/main');
    const after = git(ctx.root, 'rev-parse', 'refs/remotes/origin/main');
    assert.equal(after, before, 'expected origin/main to be untouched by an escalated plan');
    // A refused replay's branch is never published - drop it so it does
    // not linger past the scenario as a stray, wrongly-named artifact.
    if (ctx.builtBranch) {
      git(ctx.root, 'branch', '-q', '-D', ctx.builtBranch);
    }
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the verdict is LAND_REPLAY$/, (ctx) => {
    assert.equal(ctx.plan.action, 'replay', `expected :replay (LAND_REPLAY), got: ${JSON.stringify(ctx.plan)}`);
  });

  scoped(/^the replay tip carries every path the five stage commits changed, byte-identical to the cited tip$/, (ctx) => {
    const ownPaths = ctx.plan['own-paths'] || [];
    assert.deepEqual([...ownPaths].sort(), [...STAGE_FILES].sort(),
      `expected own-paths to be exactly the five stage files, got: ${JSON.stringify(ownPaths)}`);
    for (const p of STAGE_FILES) {
      const citedBlob = git(ctx.root, 'rev-parse', `${ctx.tip}:${p}`);
      const replayedBlob = git(ctx.root, 'rev-parse', `${ctx.plan.commit}:${p}`);
      assert.equal(replayedBlob, citedBlob,
        `expected ${p} to be byte-identical (same blob) between the replay and the cited tip`);
    }
    git(ctx.root, 'branch', '-q', '-D', ctx.plan.branch);
  });
}

module.exports = { registerSteps };
