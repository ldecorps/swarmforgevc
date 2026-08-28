'use strict';

// BL-1208: step handlers for "a revert instruction is earned by authorship
// of the live content, never by its liveness alone". Drives the REAL
// bounceRevertCheck adapter (extension/out/metrics/bounceRevertGitAdapter)
// against real git fixtures - same fixture conventions as
// bounceRevertCheck.test.js (BL-954), which this feature is a companion
// to and does not modify.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1208 a revert instruction is earned by authorship of the live content, never by its liveness alone';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ADAPTER = path.join(REPO_ROOT, 'extension', 'out', 'metrics', 'bounceRevertGitAdapter');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitFile(root, file, content, message) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
  git(root, ['add', file]);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function removeFile(root, file, message) {
  git(root, ['rm', '-q', file]);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function mkFixtureRoot() {
  const root = fs.realpathSync(mkSocketFixtureRoot('bl1208-acceptance-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'bl1208@example.com']);
  git(root, ['config', 'user.name', 'bl1208']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'seed']);
  return root;
}

function cleanupFixtureRoot(ctx) {
  const st = ctx.bl1208;
  if (!st || !st.root) return;
  releaseSocketFixtureRoot(st.root);
  fs.rmSync(st.root, { recursive: true, force: true });
  ctx.bl1208 = null;
}

function runCheck(root, commit, by) {
  delete require.cache[require.resolve(ADAPTER)];
  const { bounceRevertCheck } = require(ADAPTER);
  return bounceRevertCheck({ repoRoot: root, commit, by });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a bouncing review branch and a commit named to the bounce revert check$/, (ctx) => {
    ctx.bl1208 = { root: mkFixtureRoot() };
  });

  // ── scenario 01: restoration withholds the remedy ────────────────────────

  scoped(/^the commit only restores paths whose content already exists identically on a sibling review branch$/, (ctx) => {
    const st = ctx.bl1208;
    git(st.root, ['checkout', '-q', '-b', 'swarmforge-architect']);
    commitFile(st.root, 'src/thing.ts', 'important content\n', 'add thing.ts');
    removeFile(st.root, 'src/thing.ts', 'oops, accidentally deleted thing.ts');
    st.commit = commitFile(st.root, 'src/thing.ts', 'important content\n', 'recovery: restore thing.ts');
    st.by = 'architect';
    git(st.root, ['checkout', '-q', 'main']);
  });

  scoped(/^the bounce revert check runs$/, (ctx) => {
    const st = ctx.bl1208;
    st.report = runCheck(st.root, st.commit, st.by);
  });

  scoped(/^no revert instruction is offered$/, (ctx) => {
    const st = ctx.bl1208;
    assert.equal(ctx.bl1208.report.remedy, null, `expected no revert remedy, got: ${JSON.stringify(st.report)}`);
  });

  scoped(/^the verdict is not clean$/, (ctx) => {
    const st = ctx.bl1208;
    assert.notEqual(st.report.verdict, 'clean', `expected a non-clean verdict, got: ${JSON.stringify(st.report)}`);
  });

  scoped(/^every live path is still named in the finding$/, (ctx) => {
    const st = ctx.bl1208;
    try {
      assert.deepEqual(st.report.liveFiles, ['src/thing.ts'], `expected the restored path still named as live, got: ${JSON.stringify(st.report)}`);
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  // ── scenario 02: genuine unreverted bounce still earns its remedy ────────

  scoped(/^the commit authored the live content and that content is still at the tip$/, (ctx) => {
    const st = ctx.bl1208;
    git(st.root, ['checkout', '-q', '-b', 'swarmforge-architect']);
    st.commit = commitFile(st.root, 'src/a.txt', 'bounced content\n', 'BL-999: the bounced change');
    st.by = 'architect';
    git(st.root, ['checkout', '-q', 'main']);
  });

  scoped(/^the verdict is a violation$/, (ctx) => {
    const st = ctx.bl1208;
    assert.equal(st.report.verdict, 'violation', `expected a violation verdict, got: ${JSON.stringify(st.report)}`);
  });

  scoped(/^a revert instruction naming the commit and the bouncing branch is offered$/, (ctx) => {
    const st = ctx.bl1208;
    try {
      assert.match(st.report.remedy || '', /git revert/, `expected a git revert remedy, got: ${JSON.stringify(st.report)}`);
      assert.ok(st.report.remedy.includes(st.commit), `expected the remedy to name the commit ${st.commit}, got: ${st.report.remedy}`);
      assert.ok(st.report.remedy.includes(`swarmforge-${st.by}`), `expected the remedy to name the bouncing branch, got: ${st.report.remedy}`);
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  // ── scenario 03: coincidence on a sibling branch does not clear a real bounce ──

  scoped(/^the commit authored the live content and that same content also appears on a sibling review branch$/, (ctx) => {
    const st = ctx.bl1208;
    git(st.root, ['checkout', '-q', '-b', 'swarmforge-cleaner']);
    commitFile(st.root, 'src/shared.ts', 'coincidentally identical fix\n', 'cleaner: unrelated own fix');
    git(st.root, ['checkout', '-q', 'main']);
    git(st.root, ['checkout', '-q', '-b', 'swarmforge-architect']);
    st.commit = commitFile(st.root, 'src/shared.ts', 'coincidentally identical fix\n', 'architect: adds shared.ts (genuinely new here)');
    st.by = 'architect';
    git(st.root, ['checkout', '-q', 'main']);
  });

  // ── scenario 04: published history stays a breach report, no remedy ─────

  scoped(/^the commit is already an ancestor of a published main branch$/, (ctx) => {
    const st = ctx.bl1208;
    git(st.root, ['checkout', '-q', '-b', 'swarmforge-architect']);
    st.commit = commitFile(st.root, 'src/a.txt', 'published content\n', 'BL-999: the bounced change');
    git(st.root, ['checkout', '-q', 'main']);
    git(st.root, ['merge', '-q', '--no-edit', st.commit]);
    st.by = 'architect';
  });

  scoped(/^the verdict is a breach report$/, (ctx) => {
    const st = ctx.bl1208;
    assert.equal(st.report.verdict, 'breach-report', `expected a breach-report verdict, got: ${JSON.stringify(st.report)}`);
  });
  // "no revert instruction is offered" is shared, identically-worded step
  // text across scenario 01 (mid-scenario, more steps follow) and scenario
  // 04 (its own terminal step) - registered once above under scenario 01's
  // header. Scenario 04's fixture root is reaped by mkSocketFixtureRoot's
  // own process-exit backstop (BL-948) rather than an explicit cleanup
  // call here, since a second registration of the same pattern under this
  // FEATURE would never be reached (defineScoped resolves the first match).
}

module.exports = { registerSteps };
