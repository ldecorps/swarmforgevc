'use strict';

// BL-1472: a revert or reapply commit is transparent to path attribution -
// the paths it undoes or redoes belong to the commits it undoes or redoes,
// never to the revert/reapply commit itself. Drives the real land-step-lib/
// own-paths and delivered-attribution via the shared bl1446LandFixture
// helpers, never a reimplementation. Every scenario shares the same
// Background shape (a sibling merged into a reviewing branch) and only
// differs in what happens NEXT, so the Background is built eagerly here -
// unlike BL-1473/BL-1461's deferred pattern, no scenario needs a different
// FORK point, only different history on top of the same one.

const assert = require('node:assert/strict');
const {
  git,
  commit,
  initRepo,
  markOriginMainHere,
  mkTmpDir,
  ownPaths,
  deliveredAttribution,
} = require('./lib/bl1446LandFixture');

const FEATURE = 'BL-1472 Revert and reapply commits are transparent to path attribution';
const LANDING_TICKET = 'BL-9001';
const SIBLING_TICKET = 'BL-9002';
const OWN_FILE = 'backlog/active/BL-9001-x.yaml';

function revertNoEdit(root, commitSha, mainline) {
  const args = ['revert', '--no-edit'];
  if (mainline) args.push('-m', '1');
  args.push(commitSha);
  git(root, ...args);
  return git(root, 'rev-parse', 'HEAD');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture repository with an origin, a main branch, a reviewing branch, a landing ticket and an unlanded sibling ticket whose tagged commits were merged into the reviewing branch$/,
    (ctx) => {
      ctx.root = mkTmpDir('bl1472-fixture-');
      initRepo(ctx.root);
      commit(ctx.root, 'base.txt', 'base\n', 'c0 base');
      ctx.originMain = markOriginMainHere(ctx.root);
      git(ctx.root, 'checkout', '-q', '-b', 'sibling-line');
      commit(ctx.root, 'sibling.txt', 'sib\n', `${SIBLING_TICKET}: sibling adds sibling.txt`);
      const sib = git(ctx.root, 'rev-parse', 'HEAD');
      git(ctx.root, 'checkout', '-q', '-b', 'reviewing', 'main');
      // Deliberately names no ticket - the live incident's own shape
      // ("Merge documenter <sha> into QA.") and the one that actually
      // exercises the defect: a merge subject that happened to quote the
      // sibling's id as text would let commit-ticket-id resolve the
      // revert/reapply's OWN subject to BL-9002 by accident of substring
      // matching, masking the untagged-touch defect entirely.
      git(ctx.root, 'merge', '-q', '--no-ff', '-m', 'Merge sibling-line into reviewing.', sib);
      ctx.mergeSha = git(ctx.root, 'rev-parse', 'HEAD');
    },
  );

  scoped(
    /^the reviewing branch reverted the sibling's merge and then reapplied it, both commits untagged$/,
    (ctx) => {
      const revertSha = revertNoEdit(ctx.root, ctx.mergeSha, true);
      revertNoEdit(ctx.root, revertSha, false);
      ctx.tip = commit(ctx.root, OWN_FILE, `id: ${LANDING_TICKET}\n`, `${LANDING_TICKET}: own work`);
    },
  );

  scoped(
    /^the landing ticket's chain carries an untagged commit that edits a path the sibling also touched$/,
    (ctx) => {
      commit(ctx.root, 'sibling.txt', 'sib\nrefined further\n', 'coder: refine shared file further (no ticket tag)');
      ctx.tip = commit(ctx.root, OWN_FILE, `id: ${LANDING_TICKET}\n`, `${LANDING_TICKET}: own work`);
    },
  );

  scoped(
    /^a path at the tip that only untagged commits, none of them a revert or reapply, ever touched$/,
    (ctx) => {
      commit(ctx.root, 'nobody.txt', 'nobody claims this\n', 'coder: an untagged bookkeeping touch (no revert, no ticket)');
      ctx.tip = commit(ctx.root, OWN_FILE, `id: ${LANDING_TICKET}\n`, `${LANDING_TICKET}: own work`);
      ctx.targetPath = 'nobody.txt';
    },
  );

  scoped(
    /^the reviewing branch reverted one of the landing ticket's own tagged commits$/,
    (ctx) => {
      // The landing ticket's own tagged commit rides in via an early-side
      // merge (BL-1315's own established shape) so reverting the MERGE -
      // never a merge itself, git revert always produces a single-parent
      // commit - leaves a genuine, observable difference from origin/main
      // once reapplied; reverting a plain add-only commit directly nets
      // to "no diff from origin/main at all" (own.txt absent both places),
      // which own-paths would never even ask about.
      git(ctx.root, 'checkout', '-q', '-b', 'own-early-side', 'main');
      commit(ctx.root, 'own.txt', 'own content\n', `${LANDING_TICKET}: own work (early)`);
      const early = git(ctx.root, 'rev-parse', 'HEAD');
      git(ctx.root, 'checkout', '-q', 'reviewing');
      git(ctx.root, 'merge', '-q', '--no-ff', '-m', 'Merge own-early-side into reviewing (early sync, untagged).', early);
      const ownMergeSha = git(ctx.root, 'rev-parse', 'HEAD');
      const revertSha = revertNoEdit(ctx.root, ownMergeSha, true);
      revertNoEdit(ctx.root, revertSha, false);
      ctx.tip = git(ctx.root, 'rev-parse', 'HEAD');
      ctx.targetPath = 'own.txt';
    },
  );

  scoped(/^the land step computes the landing ticket's own paths$/, (ctx) => {
    ctx.ownPathsResult = ownPaths(ctx.root, ctx.tip, LANDING_TICKET, [SIBLING_TICKET]);
    ctx.attribution = deliveredAttribution(ctx.root, ctx.originMain, ctx.tip);
  });

  scoped(/^every path the sibling's tagged commits introduced is excluded as the sibling's$/, (ctx) => {
    assert.ok(
      !ctx.ownPathsResult.paths.includes('sibling.txt'),
      `expected sibling.txt excluded, got: ${JSON.stringify(ctx.ownPathsResult.paths)}`,
    );
    const excludedEntry = (ctx.ownPathsResult.excluded || []).find((e) => e.path === 'sibling.txt');
    assert.ok(excludedEntry, `expected an :excluded entry naming sibling.txt, got: ${JSON.stringify(ctx.ownPathsResult.excluded)}`);
    assert.deepEqual(excludedEntry.owners, [SIBLING_TICKET], `expected sibling.txt excluded as ${SIBLING_TICKET}'s, got: ${JSON.stringify(excludedEntry)}`);
  });

  scoped(/^neither the revert nor the reapply counts as an untagged touch on those paths$/, (ctx) => {
    const attr = ctx.attribution['sibling.txt'];
    assert.ok(attr, 'expected an attribution entry for sibling.txt');
    assert.equal(attr['any-untagged?'], false, `expected no untagged touch on sibling.txt, got: ${JSON.stringify(attr)}`);
  });

  scoped(/^that path is kept for the landing ticket with the sibling as a passenger, as BL-1315 decided$/, (ctx) => {
    // "As BL-1315 decided": BL-1315's own fixture for this exact shape
    // (land_step_lib_test_runner.bb scenario 07, "a shared path with a
    // later untagged own edit atop an unlanded sibling's touch is never
    // dropped") asserts inclusion only - the sibling's earlier content
    // "rides along" (never dropped) precisely BECAUSE the landing
    // ticket's own untagged edit keeps :any-untagged? true and so keeps
    // the exclusion clause from firing, not because the :passengers field
    // (which BL-1375's tree-guard mechanism reads, a different question:
    // an APPROVED co-owner riding a path this ticket itself also OWNS
    // by a TAGGED commit) gets populated - an untagged edit never adds
    // the landing ticket to :owners, so it never can.
    assert.ok(
      ctx.ownPathsResult.paths.includes('sibling.txt'),
      `expected sibling.txt kept for the landing ticket, got: ${JSON.stringify(ctx.ownPathsResult.paths)}`,
    );
  });

  scoped(/^that path is in the replay set, as BL-1343 decided$/, (ctx) => {
    assert.ok(
      ctx.ownPathsResult.paths.includes(ctx.targetPath),
      `expected ${ctx.targetPath} in own-paths, got: ${JSON.stringify(ctx.ownPathsResult.paths)}`,
    );
  });

  scoped(/^the paths that revert touched are attributed to the landing ticket and carry no untagged touch$/, (ctx) => {
    const attr = ctx.attribution[ctx.targetPath];
    assert.ok(attr, `expected an attribution entry for ${ctx.targetPath}`);
    assert.deepEqual(attr.owners, [LANDING_TICKET], `expected ${ctx.targetPath} attributed to ${LANDING_TICKET}, got: ${JSON.stringify(attr)}`);
    assert.equal(attr['any-untagged?'], false, `expected no untagged touch on ${ctx.targetPath}, got: ${JSON.stringify(attr)}`);
    assert.ok(
      ctx.ownPathsResult.paths.includes(ctx.targetPath),
      `expected ${ctx.targetPath} in own-paths, got: ${JSON.stringify(ctx.ownPathsResult.paths)}`,
    );
  });
}

module.exports = { registerSteps };
