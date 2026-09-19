'use strict';

// BL-875: step handlers for "The repo root carries no stray
// package-lock.json for npm to rewrite"
// (specs/features/BL-875-stray-root-package-lock-removed.feature).
//
// Scenarios 01 and 03 build a fixture git repository under mkdtemp shaped
// like this repo's own fixed root (an anchored `/package-lock.json`
// ignore rule, extension/package-lock.json tracked) - never the live
// checkout (BL-1390) - and drive real `git`/`npm` subprocesses against
// it. Scenario 02 drives the real production predicate
// (build-freshness-lib/on-deployed-surface?) via a real bb subprocess.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'The repo root carries no stray package-lock.json for npm to rewrite';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BUILD_FRESHNESS_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'build_freshness_lib.bb');

// Fixture-root hygiene (BL-971/BL-529 pattern, same as bl1230's own steps):
// every root this Background creates is registered for removal at process
// exit, and a fresh Background eagerly drops the previous scenario's root.
const fixtureRoots = [];
function registerFixtureRoot(root) {
  fixtureRoots.push(root);
}
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

// A fixture "clean checkout of main" shaped like this repo's own fixed
// root: no root package.json, a root-anchored ignore rule for
// package-lock.json, and extension/package-lock.json tracked - the exact
// shape BL-875's fix produces, built fresh under mkdtemp rather than
// read off the live worktree.
function buildFixedRootFixture(ctx) {
  if (ctx.bl875 && ctx.bl875.root) {
    fs.rmSync(ctx.bl875.root, { recursive: true, force: true });
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl875-root-'));
  registerFixtureRoot(root);
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(root, '.gitignore'), '/package-lock.json\n');
  fs.mkdirSync(path.join(root, 'extension'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'extension', 'package-lock.json'),
    '{ "name": "extension", "lockfileVersion": 3, "requires": true, "packages": {} }\n'
  );
  git(root, ['add', '.gitignore', 'extension/package-lock.json']);
  git(root, ['commit', '-q', '-m', 'seed']);
  ctx.bl875 = { root };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a clean checkout of main$/, (ctx) => {
    buildFixedRootFixture(ctx);
  });

  scoped(/^git is asked about "([^"]+)"$/, (ctx, relPath) => {
    const { root } = ctx.bl875;
    let tracked;
    try {
      tracked = git(root, ['ls-files', '--error-unmatch', relPath]).trim().length > 0;
    } catch {
      tracked = false;
    }
    const ignored = spawnSync('git', ['check-ignore', '-q', relPath], { cwd: root }).status === 0;
    ctx.bl875.result = { tracked, ignored };
  });

  scoped(/^git tracking the path is (yes|no)$/, (ctx, expected) => {
    assert.equal(ctx.bl875.result.tracked, expected === 'yes');
  });

  scoped(/^git ignoring the path is (yes|no)$/, (ctx, expected) => {
    assert.equal(ctx.bl875.result.ignored, expected === 'yes');
  });

  scoped(/^build_freshness_lib is asked about "([^"]+)"$/, (ctx, relPath) => {
    const program =
      `(load-file "${BUILD_FRESHNESS_LIB}")` +
      `(println (boolean (build-freshness-lib/on-deployed-surface? "${relPath}")))`;
    const res = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
    assert.equal(res.status, 0, `bb subprocess failed: ${res.stderr}`);
    ctx.bl875.deployedSurface = res.stdout.trim() === 'true';
  });

  scoped(/^it reports the path as a deployed surface$/, (ctx) => {
    assert.equal(ctx.bl875.deployedSurface, true);
  });

  scoped(/^npm install is run from the repo root$/, (ctx) => {
    const { root } = ctx.bl875;
    const res = spawnSync('npm', ['install'], { cwd: root, encoding: 'utf8' });
    ctx.bl875.npmResult = res;
  });

  scoped(/^the command fails with ENOENT$/, (ctx) => {
    const { status, stderr, stdout } = ctx.bl875.npmResult;
    assert.notEqual(status, 0, `expected npm install to fail, got: ${stdout}${stderr}`);
    assert.match(`${stdout}${stderr}`, /ENOENT/, `expected ENOENT, got: ${stdout}${stderr}`);
  });

  scoped(/^git status reports no change, tracked or untracked, at the repo root$/, (ctx) => {
    const status = git(ctx.bl875.root, ['status', '--porcelain']);
    assert.equal(status.trim(), '', `expected a clean status, got:\n${status}`);
  });
}

module.exports = { registerSteps };
