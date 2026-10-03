'use strict';

// BL-1897: step handlers for "A unit-test fixture never commits into the
// checkout that holds its TMPDIR". Scenario 01 runs the REAL
// extension/test/config.test.js through Vitest, with TMPDIR pointed inside a
// scratch checkout made by `git init` under a tracked mkdtemp root (BL-1636)
// and proven its own repository by --git-common-dir before the run (BL-1390),
// so a fixture that commits lands in the scratch checkout, never in a live
// one. Scenario 02 lists this repository's own tracked paths.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1897 A unit-test fixture never commits into the checkout that holds its TMPDIR';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');

// Ambient redirects never reach the scratch git calls (BL-1196's set).
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES']) delete env[k];
  return env;
}

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: cleanEnv(),
  }).trim();
}

function history(checkout) {
  return { head: git(checkout, 'rev-parse', 'HEAD'), count: git(checkout, 'rev-list', '--count', 'HEAD') };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a scratch git checkout made by git init under mkdtemp, with TMPDIR set to a directory inside it$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl1897-');
    const checkout = path.join(root, 'checkout');
    fs.mkdirSync(checkout);
    execFileSync('git', ['init', '-q', '-b', 'main', checkout], { env: cleanEnv() });
    const common = path.resolve(checkout, git(checkout, 'rev-parse', '--git-common-dir'));
    assert.equal(common, path.join(fs.realpathSync(checkout), '.git'), `the scratch checkout is not its own repository: ${common}`);
    fs.writeFileSync(path.join(checkout, 'seed.txt'), 'seed\n');
    git(checkout, 'add', 'seed.txt');
    git(checkout, 'commit', '-q', '-m', 'seed');
    const tmpdir = path.join(checkout, 'tmp', 'unit-tmpdir');
    fs.mkdirSync(tmpdir, { recursive: true });
    ctx.bl1897 = { root, checkout, tmpdir, before: history(checkout) };
  });

  scoped(/^test\/config\.test\.js runs with that TMPDIR$/, (ctx) => {
    const s = ctx.bl1897;
    const res = spawnSync('npx', ['vitest', 'run', 'test/config.test.js'], {
      cwd: EXTENSION_DIR,
      encoding: 'utf8',
      env: cleanEnv({ TMPDIR: s.tmpdir }),
      timeout: 300000,
    });
    s.run = { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
    // Read what the run did to the checkout, then remove it here, so a red
    // Then never leaves the scratch root behind.
    try {
      s.after = history(s.checkout);
      s.added = git(s.checkout, 'log', '--format=%h %s', `${s.before.head}..HEAD`);
    } finally {
      fs.rmSync(s.root, { recursive: true, force: true });
    }
  });

  scoped(/^every test in it passes$/, (ctx) => {
    const { status, out } = ctx.bl1897.run;
    assert.equal(status, 0, out.split('\n').filter((l) => /FAIL|✗|×|Tests |AssertionError/.test(l)).join('\n') || out.slice(-3000));
    assert.match(out, /Tests\s+\d+ passed/, out.slice(-2000));
  });

  scoped(/^the scratch checkout's HEAD and commit count are what they were before the run$/, (ctx) => {
    const s = ctx.bl1897;
    assert.deepEqual(s.after, s.before, `the run committed into the scratch checkout:\n${s.added}`);
  });

  scoped(/^the repository's tracked paths are listed$/, (ctx) => {
    ctx.bl1897Tracked = git(REPO_ROOT, 'ls-files').split('\n').filter(Boolean);
  });

  scoped(/^none of them is under tmp\/$/, (ctx) => {
    const under = ctx.bl1897Tracked.filter((p) => p === 'tmp' || p.startsWith('tmp/'));
    assert.deepEqual(under, [], `${under.length} tracked path(s) under tmp/:\n${under.slice(0, 10).join('\n')}`);
  });
}

module.exports = { registerSteps };
