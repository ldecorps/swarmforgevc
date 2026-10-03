'use strict';

// BL-1897 declared invariant (coder first authorship - BL-654):
//   "No unit or property test run commits into, or moves the HEAD of, the
//    git checkout that contains its TMPDIR."
//
// The mechanism is gitEnvGuard.js's ceilGitDiscoveryAtTmpdir, which
// gitEnvGuardSetup.js runs for every test file in both lanes. Every fixture
// dir comes from os.tmpdir(), so the invariant holds for a whole run exactly
// when no git command started from any dir under TMPDIR can resolve the
// checkout that holds TMPDIR. Each draw builds a fresh checkout (git init
// under mkTmpDir) with a TMPDIR inside it. It then does what the target
// bootstrap does to a "non-git directory" fixture under that TMPDIR:
// `rev-parse --is-inside-work-tree`, then `add` and `commit`. Afterwards the
// checkout's HEAD and commit count must be unchanged, and the work tree
// git saw must be the fixture's own repository or none.
//
// Collision candidates are constructed, not hoped for:
// - TMPDIR at 1-3 levels below the checkout root, so the climb always
//   crosses the ceiling into the checkout.
// - TMPDIR named through a symlink that lives OUTSIDE the checkout (macOS's
//   /var -> /private/var shape). Git resolves the physical cwd. It also
//   resolves symlinks in ceiling entries, and the helper adds the real path
//   as well, so the case is covered twice. Removing the real path alone
//   still passes; that was checked.
// - A fixture that runs `git init` at some level of its own path. Its
//   repository must still be found, so the ceiling must not over-reach.
// The reach floor asserts that each shape occurs.
//
// The full-suite claim is also checked end to end: by the feature's
// scenario 01 (the real config.test.js) and by QA's step 2 (`npm test` with
// TMPDIR inside a scratch checkout).
//
// Non-vacuity: with ceilGitDiscoveryAtTmpdir a no-op, the first draw
// without a nested init fails ("the outer checkout gained ..." /
// is-inside-work-tree true). Restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { ceilGitDiscoveryAtTmpdir } = require('./helpers/gitEnvGuard');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

function git(cwd, ...args) {
  return spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function out(cwd, ...args) {
  const r = git(cwd, ...args);
  assert.equal(r.status, 0, `git ${args.join(' ')} in ${cwd}: ${r.stderr}`);
  return r.stdout.trim();
}

function runDraw({ tmpdirDepth, viaSymlink, fixtureDepth, initAt }) {
  const checkout = mkTmpDir('sfvc-bl1897-prop-');
  out(checkout, 'init', '-q');
  fs.writeFileSync(path.join(checkout, 'seed.txt'), 'seed\n');
  out(checkout, 'add', 'seed.txt');
  out(checkout, 'commit', '-q', '-m', 'seed');
  const before = { head: out(checkout, 'rev-parse', 'HEAD'), count: out(checkout, 'rev-list', '--count', 'HEAD') };

  const physicalTmpdir = path.join(checkout, ...Array.from({ length: tmpdirDepth }, (_, i) => `t${i}`));
  fs.mkdirSync(physicalTmpdir, { recursive: true });
  let tmpdir = physicalTmpdir;
  if (viaSymlink) {
    tmpdir = path.join(mkTmpDir('sfvc-bl1897-link-'), 'tmpdir');
    fs.symlinkSync(physicalTmpdir, tmpdir);
  }
  const segments = Array.from({ length: fixtureDepth }, (_, i) => `sfvc-bootstrap-${i}`);
  const fixture = path.join(tmpdir, ...segments);
  fs.mkdirSync(fixture, { recursive: true });
  const ownRepo = initAt === null ? null : path.join(tmpdir, ...segments.slice(0, initAt + 1));
  if (ownRepo) out(ownRepo, 'init', '-q');

  const saved = process.env.GIT_CEILING_DIRECTORIES;
  let inside;
  let toplevel;
  try {
    delete process.env.GIT_CEILING_DIRECTORIES;
    ceilGitDiscoveryAtTmpdir(tmpdir);
    // The target bootstrap's own sequence on its fixture.
    inside = git(fixture, 'rev-parse', '--is-inside-work-tree').stdout.trim() === 'true';
    toplevel = inside ? git(fixture, 'rev-parse', '--show-toplevel').stdout.trim() : null;
    fs.writeFileSync(path.join(fixture, 'project.prompt'), 'fixture\n');
    git(fixture, 'add', '-f', '--', 'project.prompt');
    git(fixture, 'commit', '-q', '-m', 'Initialize SwarmForge target prompts');
  } finally {
    if (saved === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = saved;
  }

  const after = { head: out(checkout, 'rev-parse', 'HEAD'), count: out(checkout, 'rev-list', '--count', 'HEAD') };
  const added = out(checkout, 'log', '--format=%s', `${before.head}..${after.head}`);
  assert.deepEqual(after, before, `the outer checkout gained ${added}`);
  if (ownRepo) {
    assert.equal(inside, true, `the fixture's own repository at ${ownRepo} was not found`);
    assert.equal(fs.realpathSync(toplevel), fs.realpathSync(ownRepo));
  } else {
    assert.equal(inside, false, `the fixture read as inside the work tree ${toplevel}`);
  }
  return { ownRepo: Boolean(ownRepo), viaSymlink, deep: tmpdirDepth > 1 };
}

const draw = fc
  .record({
    tmpdirDepth: fc.integer({ min: 1, max: 3 }),
    viaSymlink: fc.boolean(),
    fixtureDepth: fc.integer({ min: 1, max: 3 }),
    initChoice: fc.option(fc.nat(2), { nil: null }),
  })
  .map(({ initChoice, ...d }) => ({ ...d, initAt: initChoice === null ? null : initChoice % d.fixtureDepth }));

const REACH_EXAMPLES = [
  [{ tmpdirDepth: 2, viaSymlink: false, fixtureDepth: 1, initAt: null }],
  [{ tmpdirDepth: 1, viaSymlink: true, fixtureDepth: 2, initAt: null }],
  [{ tmpdirDepth: 3, viaSymlink: true, fixtureDepth: 3, initAt: 1 }],
];

test(
  'BL-1897/BL-654 invariant: no git command started under a TMPDIR inside a checkout commits into or moves that checkout',
  () => {
    const reach = { noRepo: 0, ownRepo: 0, symlink: 0, deep: 0 };
    fc.assert(
      fc.property(draw, (d) => {
        const r = runDraw(d);
        reach[r.ownRepo ? 'ownRepo' : 'noRepo'] += 1;
        if (r.viaSymlink) reach.symlink += 1;
        if (r.deep) reach.deep += 1;
      }),
      { numRuns: 12, examples: REACH_EXAMPLES }
    );
    for (const k of Object.keys(reach)) assert.ok(reach[k] >= 1, `${k} reached: ${JSON.stringify(reach)}`);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
