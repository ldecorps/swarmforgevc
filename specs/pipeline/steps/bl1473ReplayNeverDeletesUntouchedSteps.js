'use strict';

// BL-1473: the land step's own-paths must never carry a path that origin/
// main gained, deleted or changed after the parcel branch forked, unless
// some commit in the parcel's OWN range actually touched it. Drives the
// real land-step-lib/own-paths and replay! via the shared bl1446LandFixture
// helpers, never a reimplementation. Each scenario builds its own fixture
// (the Background records intent only, per BL-1461's own deferred-fixture
// pattern) because each needs a different shape of "what origin/main did
// after the fork".

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  git,
  commit,
  initRepo,
  markOriginMainHere,
  mkTmpDir,
  ownPaths,
  replay,
} = require('./lib/bl1446LandFixture');

const FEATURE = 'BL-1473 A replay never deletes or resurrects a path the parcel never touched';
const TASK = 'BL-9001';
const OWN_FILE = 'backlog/active/BL-9001-x.yaml';

function pathAbsentAt(root, commitSha, relPath) {
  const result = spawnSync('git', ['-C', root, 'cat-file', '-e', `${commitSha}:${relPath}`], { encoding: 'utf8' });
  return result.status !== 0;
}

function blobAt(root, commitSha, relPath) {
  return git(root, 'show', `${commitSha}:${relPath}`);
}

function buildReplay(ctx) {
  const result = replay(ctx.root, ctx.parcelTip, TASK, ctx.ownPathsResult.paths, []);
  assert.ok(result.success, `expected replay! to succeed, got: ${JSON.stringify(result)}`);
  ctx.replayCommit = result.commit;
  return result;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture repository with an origin, a main branch, a parcel branch forked from it, and a tip-pure land planned for the parcel$/,
    (ctx) => {
      // Deferred: each scenario's own Given decides what origin/main does
      // AFTER the fork, which must be built before the fork itself exists
      // (a file origin/main "still has" must be seeded before branching) -
      // never a rebuild, never two fixtures disagreeing on shape. Same
      // posture as BL-1461's own backgroundPending.
      ctx.backgroundPending = true;
    },
  );

  scoped(
    /^origin\/main gained a file after the parcel branch forked and no commit of the parcel touched it$/,
    (ctx) => {
      assert.ok(ctx.backgroundPending, 'expected the Background to have run first');
      ctx.root = mkTmpDir('bl1473-fixture-');
      initRepo(ctx.root);
      git(ctx.root, 'checkout', '-q', '-b', 'parcel');
      ctx.parcelTip = commit(ctx.root, OWN_FILE, 'id: BL-9001\n', 'BL-9001: own work');
      git(ctx.root, 'checkout', '-q', 'main');
      commit(ctx.root, 'gained.txt', 'main gains this after the fork\n', 'main: gains gained.txt after the fork');
      markOriginMainHere(ctx.root);
      ctx.targetPath = 'gained.txt';
    },
  );

  scoped(
    /^origin\/main deleted a file after the parcel branch forked and no commit of the parcel touched it$/,
    (ctx) => {
      assert.ok(ctx.backgroundPending, 'expected the Background to have run first');
      ctx.root = mkTmpDir('bl1473-fixture-');
      initRepo(ctx.root);
      commit(ctx.root, 'untouched.txt', 'fork content of untouched.txt\n', 'c0: seeds untouched.txt');
      git(ctx.root, 'checkout', '-q', '-b', 'parcel');
      ctx.parcelTip = commit(ctx.root, OWN_FILE, 'id: BL-9001\n', 'BL-9001: own work');
      git(ctx.root, 'checkout', '-q', 'main');
      git(ctx.root, 'rm', '-q', 'untouched.txt');
      git(ctx.root, 'commit', '-q', '-m', 'main: deletes untouched.txt after the fork');
      markOriginMainHere(ctx.root);
      ctx.targetPath = 'untouched.txt';
    },
  );

  scoped(
    /^a commit in the parcel's own range deleted a file that origin\/main still has$/,
    (ctx) => {
      assert.ok(ctx.backgroundPending, 'expected the Background to have run first');
      ctx.root = mkTmpDir('bl1473-fixture-');
      initRepo(ctx.root);
      commit(ctx.root, 'own-delete.txt', 'fork content of own-delete.txt\n', 'c0: seeds own-delete.txt');
      git(ctx.root, 'checkout', '-q', '-b', 'parcel');
      commit(ctx.root, OWN_FILE, 'id: BL-9001\n', 'BL-9001: own work');
      git(ctx.root, 'rm', '-q', 'own-delete.txt');
      git(ctx.root, 'commit', '-q', '-m', 'BL-9001: deletes own-delete.txt');
      ctx.parcelTip = git(ctx.root, 'rev-parse', 'HEAD');
      git(ctx.root, 'checkout', '-q', 'main');
      markOriginMainHere(ctx.root);
      ctx.targetPath = 'own-delete.txt';
    },
  );

  scoped(
    /^the parcel's content reached the branch through a merge that predates its tagged merge, as in BL-1315$/,
    (ctx) => {
      assert.ok(ctx.backgroundPending, 'expected the Background to have run first');
      ctx.root = mkTmpDir('bl1473-fixture-');
      initRepo(ctx.root);
      const seed = markOriginMainHere(ctx.root);
      git(ctx.root, 'checkout', '-q', '-b', 'early-side', seed);
      commit(ctx.root, 'early.txt', 'early side work\n', 'early side work (untagged)');
      const earlySide = git(ctx.root, 'rev-parse', 'HEAD');
      git(ctx.root, 'checkout', '-q', '-b', 'parcel', seed);
      git(ctx.root, 'merge', '-q', '--no-ff', '-m', 'merge early-side into parcel (early sync, untagged)', earlySide);
      ctx.parcelTip = commit(ctx.root, OWN_FILE, 'id: BL-9001\n', 'BL-9001: own tagged work');
      git(ctx.root, 'checkout', '-q', 'main');
      ctx.targetPaths = ['early.txt', OWN_FILE];
    },
  );

  scoped(/^the land step computes the parcel's own paths$/, (ctx) => {
    ctx.ownPathsResult = ownPaths(ctx.root, ctx.parcelTip, TASK);
    assert.equal(ctx.ownPathsResult.warning, null,
      `expected a clean own-paths read, got warning: ${ctx.ownPathsResult.warning}`);
  });

  scoped(/^that file is not in the own-path set$/, (ctx) => {
    assert.ok(!ctx.ownPathsResult.paths.includes(ctx.targetPath),
      `expected ${ctx.targetPath} to be excluded from own-paths, got: ${JSON.stringify(ctx.ownPathsResult.paths)}`);
  });

  scoped(/^that file is in the own-path set and the built replay removes it$/, (ctx) => {
    assert.ok(ctx.ownPathsResult.paths.includes(ctx.targetPath),
      `expected ${ctx.targetPath} to be included in own-paths, got: ${JSON.stringify(ctx.ownPathsResult.paths)}`);
    buildReplay(ctx);
    assert.ok(pathAbsentAt(ctx.root, ctx.replayCommit, ctx.targetPath),
      `expected ${ctx.targetPath} to be ABSENT from the replay tip`);
  });

  scoped(/^the built replay leaves it exactly as origin\/main has it$/, (ctx) => {
    buildReplay(ctx);
    const originMain = git(ctx.root, 'rev-parse', 'origin/main');
    assert.ok(!pathAbsentAt(ctx.root, originMain, ctx.targetPath),
      `test setup error: expected ${ctx.targetPath} present on origin/main`);
    assert.ok(!pathAbsentAt(ctx.root, ctx.replayCommit, ctx.targetPath),
      `expected ${ctx.targetPath} present in the replay tip, matching origin/main`);
    assert.equal(
      blobAt(ctx.root, ctx.replayCommit, ctx.targetPath),
      blobAt(ctx.root, originMain, ctx.targetPath),
      `expected ${ctx.targetPath} in the replay tip to be byte-identical to origin/main's`,
    );
  });

  scoped(/^the built replay does not restore it$/, (ctx) => {
    buildReplay(ctx);
    const originMain = git(ctx.root, 'rev-parse', 'origin/main');
    assert.ok(pathAbsentAt(ctx.root, originMain, ctx.targetPath),
      `test setup error: expected ${ctx.targetPath} absent from origin/main`);
    assert.ok(pathAbsentAt(ctx.root, ctx.replayCommit, ctx.targetPath),
      `expected ${ctx.targetPath} to stay ABSENT from the replay tip, not resurrected`);
  });

  scoped(/^every one of those paths is in the own-path set$/, (ctx) => {
    for (const p of ctx.targetPaths) {
      assert.ok(ctx.ownPathsResult.paths.includes(p),
        `expected ${p} to be in own-paths, got: ${JSON.stringify(ctx.ownPathsResult.paths)}`);
    }
  });
}

module.exports = { registerSteps };
