'use strict';

// BL-1806: step handlers for "A land-plan over a fat QA tip finishes fast".
// Drives the REAL land-step-lib/land-plan (via bl1446LandFixture.landPlan),
// never a reimplementation. Fat tip is synthesised under mkdtemp with its
// own origin/main - never the live QA worktree (BL-1390).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  STAGE_FILES,
  git,
  commit,
  initRepo,
  markOriginMainHere,
  recordHandoff,
  mkTmpDir,
  landPlan,
} = require('./lib/bl1446LandFixture');

const FEATURE = 'BL-1806 A land-plan over a fat QA tip finishes fast';

const LANDING = 'BL-9806';
const SIBLING = 'BL-9807';
const SIBLING_FILE = `backlog/active/${SIBLING}-x.yaml`;
const FAT_COMMITS = 1000;

function buildFatSide(root, seed) {
  // Linear side DAG of FAT_COMMITS empty commits off seed, built with
  // commit-tree so fixture setup stays seconds (not minutes of checkout
  // loops). Then one --no-ff merge into main so full ancestry is fat while
  // first-parent stays short.
  const tree = git(root, 'rev-parse', `${seed}^{tree}`);
  let parent = seed;
  for (let i = 0; i < FAT_COMMITS; i++) {
    parent = execFileSync(
      'git',
      ['-C', root, 'commit-tree', tree, '-p', parent, '-m', `fat ${i}`],
      { encoding: 'utf8' },
    ).trim();
  }
  git(root, 'checkout', '-q', 'main');
  // Ensure main is at seed before the merge (initRepo left us there; a
  // prior scenario may have moved HEAD).
  git(root, 'reset', '-q', '--hard', seed);
  git(root, 'merge', '-q', '--no-ff', '-m', 'Merge fat side into QA tip', parent);
  return git(root, 'rev-parse', 'HEAD');
}

function buildParcelStages(root, ticketId) {
  const roles = ['coder', 'cleaner', 'architect', 'hardender', 'documenter'];
  let tip;
  STAGE_FILES.forEach((file, i) => {
    const named = file.replace('BL-9001', ticketId);
    tip = commit(root, named, `id: ${ticketId}\n`, `${ticketId}: ${roles[i]}`);
  });
  return tip;
}

function ancestryCounts(root, tip, originMain) {
  const full = Number(
    execFileSync(
      'git',
      ['-C', root, 'rev-list', '--count', `${originMain}..${tip}`],
      { encoding: 'utf8' },
    ).trim(),
  );
  const firstParent = Number(
    execFileSync(
      'git',
      ['-C', root, 'rev-list', '--count', '--first-parent', `${originMain}..${tip}`],
      { encoding: 'utf8' },
    ).trim(),
  );
  return { full, firstParent };
}

function buildOwnOnlyFatTip(ctx) {
  ctx.root = mkTmpDir('bl1806-own-');
  initRepo(ctx.root);
  const seed = markOriginMainHere(ctx.root);
  ctx.originMain = seed;
  buildFatSide(ctx.root, seed);
  ctx.tip = buildParcelStages(ctx.root, LANDING);
  recordHandoff(ctx.root, `${LANDING}-fixture`, ctx.tip);
  ctx.counts = ancestryCounts(ctx.root, ctx.tip, ctx.originMain);
}

function buildTipPureEquivalent(ctx) {
  // Same parcel stages, no fat merge history - the verdict land-plan must
  // match on action (and entangled set) for scenario 01.
  ctx.pureRoot = mkTmpDir('bl1806-pure-');
  initRepo(ctx.pureRoot);
  const seed = markOriginMainHere(ctx.pureRoot);
  ctx.pureOriginMain = seed;
  ctx.pureTip = buildParcelStages(ctx.pureRoot, LANDING);
  recordHandoff(ctx.pureRoot, `${LANDING}-fixture`, ctx.pureTip);
}

function buildFatTipWithPreHopSibling(ctx) {
  ctx.root = mkTmpDir('bl1806-sib-');
  initRepo(ctx.root);
  const seed = markOriginMainHere(ctx.root);
  ctx.originMain = seed;
  buildFatSide(ctx.root, seed);
  // Sibling absorbed BEFORE the parcel's first hop (BL-1461 shape).
  commit(ctx.root, SIBLING_FILE, `id: ${SIBLING}\n`, `${SIBLING}: sibling ticket`);
  ctx.tip = buildParcelStages(ctx.root, LANDING);
  recordHandoff(ctx.root, `${LANDING}-fixture`, ctx.tip);
  ctx.counts = ancestryCounts(ctx.root, ctx.tip, ctx.originMain);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository whose origin\/main is behind a QA tip$/, () => {
    // Background only - each scenario builds its own tip shape.
  });

  scoped(
    /^the QA tip's full ancestry has at least 1000 commits and its first-parent ancestry has fewer than 20$/,
    (ctx) => {
      buildOwnOnlyFatTip(ctx);
      assert.ok(ctx.counts.full >= 1000, `full ancestry ${ctx.counts.full} < 1000`);
      assert.ok(
        ctx.counts.firstParent < 20,
        `first-parent ancestry ${ctx.counts.firstParent} >= 20`,
      );
    },
  );

  scoped(/^the tip carries only the landing ticket's own work since origin\/main$/, (ctx) => {
    assert.ok(ctx.tip, 'own-only fat tip must already be built');
    buildTipPureEquivalent(ctx);
  });

  scoped(/^an unlanded sibling's work was absorbed before the landing ticket's last hop$/, (ctx) => {
    buildFatTipWithPreHopSibling(ctx);
  });

  scoped(/^the QA tip's full ancestry has at least 1000 commits$/, (ctx) => {
    assert.ok(ctx.counts, 'fat tip with sibling must already be built');
    assert.ok(ctx.counts.full >= 1000, `full ancestry ${ctx.counts.full} < 1000`);
  });

  scoped(/^land-plan runs for the landing ticket at that tip$/, (ctx) => {
    const t0 = Date.now();
    ctx.plan = landPlan(ctx.root, ctx.tip, LANDING);
    ctx.planMs = Date.now() - t0;
  });

  scoped(/^it returns a verdict in under 10 seconds$/, (ctx) => {
    assert.ok(
      ctx.planMs < 10000,
      `land-plan took ${ctx.planMs}ms (>= 10000); action=${ctx.plan && ctx.plan.action}`,
    );
    assert.ok(ctx.plan && ctx.plan.action, 'land-plan returned no action');
  });

  scoped(/^the verdict matches a tip-pure equivalent of the same parcel$/, (ctx) => {
    const pure = landPlan(ctx.pureRoot, ctx.pureTip, LANDING);
    assert.equal(
      ctx.plan.action,
      pure.action,
      `fat tip action ${ctx.plan.action} != tip-pure ${pure.action}`,
    );
    const fatEnt = [...(ctx.plan.entangled || [])].sort().join(',');
    const pureEnt = [...(pure.entangled || [])].sort().join(',');
    assert.equal(fatEnt, pureEnt, `fat entangled {${fatEnt}} != tip-pure {${pureEnt}}`);
  });

  scoped(/^the verdict is LAND_REPLAY naming that sibling$/, (ctx) => {
    assert.equal(ctx.plan.action, 'replay', `expected replay, got ${ctx.plan.action}`);
    const unlanded = new Set(ctx.plan.unlanded || ctx.plan.entangled || []);
    assert.ok(
      unlanded.has(SIBLING),
      `expected ${SIBLING} in unlanded/entangled; got ${[...unlanded].join(',')}`,
    );
  });
}

module.exports = { registerSteps };
