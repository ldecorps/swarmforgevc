'use strict';

// BL-1802: step handlers for "a reset to origin/main only ever moves
// main". Scenarios 01-03 drive specs/pipeline/steps/lib/
// bl1802ResetOnlyMovesMainCli.bb, which calls master_main_reconcile_lib.bb's
// REAL refuse-reset-if-local-ahead! composed with its REAL
// real-git-reset-adapters against a real fixture checkout (clone or linked
// worktree) - never a reimplementation of the gate. Scenario 04 is a
// source census, the same shape BL-1445 already established: it re-derives
// the reset call sites from the reset command itself, so a matcher blind to
// one call form cannot silently pass on a smaller set.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1802 A reset to origin/main only ever moves main';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(__dirname, 'lib', 'bl1802ResetOnlyMovesMainCli.bb');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initBareRemote(root) {
  git(root, ['init', '-q', '--bare', '.']);
  git(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
}

function initClone(root, remoteRoot) {
  git(root, ['init', '-q', '-b', 'main', '.']);
  git(root, ['config', 'user.email', 'bl1802@example.com']);
  git(root, ['config', 'user.name', 'bl1802']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  git(root, ['remote', 'add', 'origin', remoteRoot]);
  git(root, ['push', '-q', 'origin', 'main']);
}

function commitFile(root, name, content, message) {
  fs.writeFileSync(path.join(root, name), `${content}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function cleanupFixture(ctx) {
  const st = ctx.bl1802;
  if (!st) return;
  if (st.checkoutRoot && st.checkoutRoot !== st.root && fs.existsSync(st.checkoutRoot)) {
    try {
      git(st.root, ['worktree', 'remove', '-f', st.checkoutRoot]);
    } catch {
      // already gone or never registered as a worktree - fall through to rmSync
    }
  }
  for (const root of [st.checkoutRoot, st.root, st.remoteRoot]) {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
      releaseSocketFixtureRoot(root);
    }
  }
  ctx.bl1802 = null;
}

function runCli(root, { noBranchReading } = {}) {
  const args = [CLI, root];
  if (noBranchReading) args.push('--no-branch-reading');
  const result = spawnSync('bb', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, `bl1802ResetOnlyMovesMainCli.bb exited ${result.status}: ${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

// Explicit KNOWN_VALUES for the Scenario Outline's <checkout> placeholder.
const CHECKOUT_BUILDERS = {
  'a linked worktree on branch swarmforge-QA': (st) => {
    const wtRoot = fs.realpathSync(mkSocketFixtureRoot('bl1802-qa-wt-'));
    fs.rmdirSync(wtRoot);
    git(st.root, ['worktree', 'add', '-q', '-b', 'swarmforge-QA', wtRoot, 'main']);
    return wtRoot;
  },
  'a linked worktree on a detached HEAD': (st) => {
    const wtRoot = fs.realpathSync(mkSocketFixtureRoot('bl1802-detached-wt-'));
    fs.rmdirSync(wtRoot);
    git(st.root, ['worktree', 'add', '-q', '--detach', wtRoot, 'main']);
    return wtRoot;
  },
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^a fixture origin and a clone on main whose main equals origin\/main$/, (ctx) => {
    const remoteRoot = fs.realpathSync(mkSocketFixtureRoot('bl1802-origin-'));
    const root = fs.realpathSync(mkSocketFixtureRoot('bl1802-clone-'));
    initBareRemote(remoteRoot);
    initClone(root, remoteRoot);
    ctx.bl1802 = { remoteRoot, root };
  });

  // ── Scenario Outline 01 ──────────────────────────────────────────────
  scoped(/^(.+) holding one commit origin\/main lacks$/, (ctx, checkout) => {
    const build = CHECKOUT_BUILDERS[checkout];
    assert.ok(build, `unknown <checkout> example value "${checkout}"`);
    const st = ctx.bl1802;
    const checkoutRoot = build(st);
    const sha = commitFile(checkoutRoot, 'own-commit.txt', 'own-commit', `${checkout} own commit (BL-1802 acceptance)`);
    st.checkoutRoot = checkoutRoot;
    st.ownSha = sha;
  });

  scoped(/^the reset to origin\/main runs in that checkout$/, (ctx) => {
    const st = ctx.bl1802;
    st.result = runCli(st.checkoutRoot);
    st.headAfter = git(st.checkoutRoot, ['rev-parse', 'HEAD']);
  });

  scoped(/^it refuses with the outcome "([^"]+)"$/, (ctx, outcome) => {
    const st = ctx.bl1802;
    assert.equal(st.result.success, false, `expected a refusal, got: ${JSON.stringify(st.result)}`);
    assert.equal(st.result.outcome, outcome, `expected outcome ${outcome}, got: ${JSON.stringify(st.result)}`);
  });

  scoped(/^that checkout still holds its own commit$/, (ctx) => {
    const st = ctx.bl1802;
    try {
      assert.equal(st.headAfter, st.ownSha, `expected HEAD to still be ${st.ownSha}, got ${st.headAfter}`);
    } finally {
      cleanupFixture(ctx);
    }
  });

  // ── Scenario 02 ─────────────────────────────────────────────────────────
  scoped(/^origin\/main has one commit the clone's main has not merged$/, (ctx) => {
    const st = ctx.bl1802;
    const otherRoot = fs.realpathSync(mkSocketFixtureRoot('bl1802-other-'));
    git(otherRoot, ['clone', '-q', st.remoteRoot, '.']);
    git(otherRoot, ['config', 'user.email', 'bl1802@example.com']);
    git(otherRoot, ['config', 'user.name', 'bl1802']);
    git(otherRoot, ['config', 'commit.gpgsign', 'false']);
    st.originSha = commitFile(otherRoot, 'origin-advance.txt', 'origin-advance', 'origin advances (BL-1802 acceptance)');
    git(otherRoot, ['push', '-q', 'origin', 'main']);
    fs.rmSync(otherRoot, { recursive: true, force: true });
    releaseSocketFixtureRoot(otherRoot);
    git(st.root, ['fetch', '-q', 'origin', 'main']);
  });

  scoped(/^the reset to origin\/main runs in the clone$/, (ctx) => {
    const st = ctx.bl1802;
    st.result = runCli(st.root);
  });

  scoped(/^the clone's main points at origin\/main$/, (ctx) => {
    const st = ctx.bl1802;
    try {
      assert.equal(st.result.success, true, `expected the reset to succeed, got: ${JSON.stringify(st.result)}`);
      const cloneHead = git(st.root, ['rev-parse', 'HEAD']);
      assert.equal(cloneHead, st.originSha, `expected the clone's main at ${st.originSha}, got ${cloneHead}`);
    } finally {
      cleanupFixture(ctx);
    }
  });

  // ── Scenario 03 ─────────────────────────────────────────────────────────
  scoped(/^the gate is called without a current-branch reading$/, (ctx) => {
    const st = ctx.bl1802;
    st.result = runCli(st.root, { noBranchReading: true });
  });

  scoped(/^the reset adapter was never called$/, (ctx) => {
    const st = ctx.bl1802;
    try {
      assert.equal(st.result.resetAttempted, false, `expected the raw reset adapter never to run, got: ${JSON.stringify(st.result)}`);
    } finally {
      cleanupFixture(ctx);
    }
  });

  // ── Scenario 04: census ──────────────────────────────────────────────────
  // Mirrors the ticket's own mint-time grep: `grep -rn -E
  // "reset.{0,30}origin/main" swarmforge/scripts extension/src`, minus
  // comments and test/ paths.
  scoped(/^the scripts that run a reset to origin\/main are found by their reset command$/, (ctx) => {
    const searchDirs = ['swarmforge/scripts', 'extension/src'];
    // The actual argv literal shape every real invocation shares
    // ("reset" "--hard" "origin/main", in a bb vector or call args) -
    // never a loose text match, which also catches BL-1124's own guard
    // MESSAGE text describing what it refuses
    // (property_suite_shared_repo_guard.sh) and this file's own doc
    // comments, neither of which executes a reset.
    const resetRe = /"reset"\s*"--hard"\s*"origin\/main"/;
    const hits = new Set();

    function walk(dir) {
      const abs = path.join(REPO_ROOT, dir);
      if (!fs.existsSync(abs)) return;
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (rel.split(path.sep).includes('test')) continue;
          walk(rel);
        } else if (entry.isFile()) {
          const abs2 = path.join(REPO_ROOT, rel);
          let text;
          try {
            text = fs.readFileSync(abs2, 'utf8');
          } catch {
            continue;
          }
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            const trimmed = line.trim();
            if (trimmed.startsWith(';;') || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;
            if (resetRe.test(line)) {
              hits.add(rel.split(path.sep).join('/'));
              break;
            }
          }
        }
      }
    }

    for (const d of searchDirs) walk(d);
    ctx.censusFiles = Array.from(hits).sort();
  });

  scoped(/^each passes a current-branch reading to refuse-reset-if-local-ahead!$/, (ctx) => {
    for (const rel of ctx.censusFiles) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.match(
        text,
        /current-branch!/,
        `${rel} carries a reset-to-origin/main command but no :current-branch! wiring (BL-1802)`
      );
    }
  });

  scoped(/^the census is exactly (\d+) scripts and includes "([^"]+)"$/, (ctx, countStr, mustInclude) => {
    assert.equal(ctx.censusFiles.length, Number(countStr), `expected exactly ${countStr} scripts, got: ${JSON.stringify(ctx.censusFiles)}`);
    assert.ok(ctx.censusFiles.includes(mustInclude), `expected the census to include ${mustInclude}, got: ${JSON.stringify(ctx.censusFiles)}`);
  });
}

module.exports = { registerSteps };
