'use strict';

// BL-1892: step handlers for "A land told to stop releases its lock and
// stops, but never mid re-point". Runs the REAL land_main_publish.sh --land
// against a bare-origin fixture under mkdtemp (BL-1390: proven by
// --git-common-dir before any mutating command). The moment each scenario
// signals at is made by a real git hook in the fixture, never a seam in the
// script: a pre-push hook (scenario 01) and a reference-transaction hook on
// the re-pointed branch (scenario 02) mark the moment and sleep. The land
// runs in its own session (setsid), and the TERM goes to its whole process
// group - the harder case, which also reaches the land's children.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = 'BL-1892 A land told to stop releases its lock and stops, but never mid re-point';
const LAND = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'land_main_publish.sh');
const BRANCH = 'swarmforge-lander';

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function makeFixture() {
  const work = mkProcessTmpDir('bl1892acc-');
  const origin = path.join(work, 'origin.git');
  const root = path.join(work, 'repo');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  assert.equal(path.resolve(root, git(root, 'rev-parse', '--git-common-dir')), path.join(root, '.git'));
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false']]) git(root, 'config', k, v);
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n.worktrees/\n');
  git(root, 'add', '.gitignore');
  git(root, 'commit', '-q', '-m', 'seed');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '-q', 'origin', 'main');
  git(root, 'fetch', '-q', 'origin');
  const side = path.join(root, '.worktrees', 'side');
  git(root, 'worktree', 'add', '-q', '--detach', side, 'origin/main');
  fs.writeFileSync(path.join(side, 'a.txt'), 'a\n');
  git(side, 'add', 'a.txt');
  git(side, 'commit', '-q', '-m', 'BL-9001: own line');
  const sha = git(side, 'rev-parse', 'HEAD');
  git(root, 'checkout', '-q', '-b', BRANCH, 'origin/main');
  return { work, origin, root, sha, marker: path.join(work, 'at-the-moment') };
}

function ensure(ctx) {
  if (!ctx.bl1892) ctx.bl1892 = makeFixture();
  return ctx.bl1892;
}

function hook(fx, name, body) {
  const f = path.join(fx.root, '.git', 'hooks', name);
  fs.writeFileSync(f, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with a bare origin and the land publish script$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^a land of (BL-\d+) that has not yet pushed$/, (ctx) => {
    const fx = ensure(ctx);
    // The push is about to happen: the land holds the lock and has built its commit.
    hook(fx, 'pre-push', `touch ${JSON.stringify(fx.marker)}; sleep 20`);
  });

  scoped(/^a land of (BL-\d+) that has published and is re-pointing its branch$/, (ctx) => {
    const fx = ensure(ctx);
    // The re-point moving the branch ref: mark, then hold the transaction open.
    hook(
      fx,
      'reference-transaction',
      `[ "$1" = prepared ] || exit 0
while read -r old new ref; do
  if [ "$ref" = "refs/heads/${BRANCH}" ] && [ ! -e ${JSON.stringify(fx.marker)} ]; then
    touch ${JSON.stringify(fx.marker)}; sleep 4
  fi
done
exit 0`
    );
    fx.repointing = true;
  });

  scoped(/^the land is sent TERM$/, (ctx) => {
    const fx = ensure(ctx);
    fx.originBefore = git(fx.origin, 'rev-parse', 'main');
    fx.branchBefore = git(fx.root, 'rev-parse', BRANCH);
    const driver = `
setsid bash ${JSON.stringify(LAND)} ${JSON.stringify(fx.root)} --land BL-9001 ${fx.sha} > ${JSON.stringify(path.join(fx.work, 'land.out'))} 2>&1 &
pid=$!
for i in $(seq 1 600); do [ -e ${JSON.stringify(fx.marker)} ] && break; sleep 0.1; done
[ -e ${JSON.stringify(fx.marker)} ] || { echo NO_MOMENT; kill -TERM -- -$pid 2>/dev/null; wait $pid; exit 0; }
sleep 0.3
kill -TERM -- -$pid
wait $pid
echo "rc=$?"`;
    fx.driverOut = execFileSync('bash', ['-c', driver], { encoding: 'utf8', timeout: 120000 });
    fx.landOut = fs.readFileSync(path.join(fx.work, 'land.out'), 'utf8');
    assert.doesNotMatch(fx.driverOut, /NO_MOMENT/, `the land never reached the moment:\n${fx.landOut}`);
    fx.rc = Number((fx.driverOut.match(/rc=(\d+)/) || [])[1]);
  });

  scoped(/^the land exits non-zero$/, (ctx) => {
    const fx = ensure(ctx);
    assert.notEqual(fx.rc, 0, fx.landOut);
  });

  scoped(/^the land lock is released$/, (ctx) => {
    const fx = ensure(ctx);
    assert.equal(fs.existsSync(path.join(fx.root, '.swarmforge', 'land-main.publish.lock')), false, fx.landOut);
  });

  scoped(/^origin\/main has not changed$/, (ctx) => {
    const fx = ensure(ctx);
    assert.equal(git(fx.origin, 'rev-parse', 'main'), fx.originBefore, fx.landOut);
  });

  scoped(/^the re-point completes and the branch is not left half-moved$/, (ctx) => {
    const fx = ensure(ctx);
    const published = (fx.landOut.match(/^LAND_PUBLISHED ([0-9a-f]{40})/m) || [])[1];
    assert.ok(published, fx.landOut);
    assert.match(fx.landOut, /LAND_REPOINTED/, fx.landOut);
    assert.equal(git(fx.root, 'rev-parse', BRANCH), published, fx.landOut);
    assert.equal(git(fx.root, 'symbolic-ref', '--short', 'HEAD'), BRANCH);
    assert.equal(git(fx.root, 'status', '--porcelain'), '', 'the worktree was left mid-change');
  });
}

module.exports = { registerSteps };
