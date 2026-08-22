const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkoutSeededRepo, seedCount, resetForTest } = require('./helpers/sharedRepoFixture');

// BL-1039: 17 unit-lane files ran `git init` + config + an empty commit per
// SCENARIO - four spawns before the behaviour under test was reached, ~165.9s
// of a 533.8s lane. One seeding per run, independent copies per caller.

function log(dir) {
  return execFileSync('git', ['-C', dir, 'log', '--format=%s'], { encoding: 'utf8' }).trim();
}

test('BL-1039: a checkout is a real repo with the seeded history', () => {
  const dir = checkoutSeededRepo('bl1039-t1-');
  try {
    assert.ok(fs.existsSync(path.join(dir, '.git')), 'must be a real git repository');
    assert.equal(log(dir), 'init', 'and carry the seeded commit');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-1039: the template is seeded ONCE however many checkouts are taken', () => {
  resetForTest();
  const dirs = [checkoutSeededRepo('bl1039-t2a-'), checkoutSeededRepo('bl1039-t2b-'), checkoutSeededRepo('bl1039-t2c-')];
  try {
    assert.equal(seedCount(), 1, 'three checkouts must cost one seeding, not three');
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});

test("BL-1039: one checkout's commits are never visible in another", () => {
  // The whole risk of sharing. Isolation is structural - separate directories -
  // so there is no cleanup to forget and no ordering to get right.
  const a = checkoutSeededRepo('bl1039-t3a-');
  const b = checkoutSeededRepo('bl1039-t3b-');
  try {
    fs.writeFileSync(path.join(a, 'only-in-a.txt'), 'x');
    execFileSync('git', ['-C', a, 'add', '-A']);
    execFileSync('git', ['-C', a, 'commit', '-q', '-m', 'a-only']);
    assert.match(log(a), /a-only/, "the writer must see its own commit");
    assert.equal(log(b), 'init', "the other copy must observe the seeded history ONLY");
    assert.ok(!fs.existsSync(path.join(b, 'only-in-a.txt')), 'and none of its files');
  } finally {
    for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('BL-1039: isolation holds in either order - it is not an artefact of who ran first', () => {
  const b = checkoutSeededRepo('bl1039-t4b-');
  const a = checkoutSeededRepo('bl1039-t4a-');
  try {
    fs.writeFileSync(path.join(a, 'x.txt'), 'x');
    execFileSync('git', ['-C', a, 'add', '-A']);
    execFileSync('git', ['-C', a, 'commit', '-q', '-m', 'later-writer']);
    assert.equal(log(b), 'init', 'a copy taken FIRST must still be unaffected');
  } finally {
    for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('BL-1039: a checkout costs no git spawn of its own', () => {
  // The saving, stated as a property of the mechanism: after the template
  // exists, taking a copy must not re-seed.
  resetForTest();
  checkoutSeededRepo('bl1039-t5a-');
  const after = seedCount();
  const d = checkoutSeededRepo('bl1039-t5b-');
  try {
    assert.equal(seedCount(), after, 'a second checkout must not seed again');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('BL-1039: copySeededRepoInto seeds an existing directory in place', () => {
  // Most callers already own a root with its cleanup registered; they only
  // want the repository put into it, not a second directory to manage.
  const { mkTmpDir } = require('./helpers/tmpDir');
  const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');
  const root = mkTmpDir('bl1039-inplace-');
  copySeededRepoInto(root);
  assert.ok(fs.existsSync(path.join(root, '.git')), 'the caller_s own directory becomes the repo');
  assert.equal(log(root), 'init');
});

test('BL-1039: two in-place seedings are still isolated from each other', () => {
  const { mkTmpDir } = require('./helpers/tmpDir');
  const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');
  const a = copySeededRepoInto(mkTmpDir('bl1039-ip-a-'));
  const b = copySeededRepoInto(mkTmpDir('bl1039-ip-b-'));
  fs.writeFileSync(path.join(a, 'f.txt'), 'x');
  execFileSync('git', ['-C', a, 'add', '-A']);
  execFileSync('git', ['-C', a, 'commit', '-q', '-m', 'in-a']);
  assert.equal(log(b), 'init', 'the other caller must observe the seeded history only');
});

// The template's branch name is part of the contract callers see, not an
// incidental of the host. Before this was pinned, a converted caller running
// `git checkout main` passed or failed by the machine's `init.defaultBranch`
// rather than by its own subject - bounceRevertCheck.test.js seeded
// `init -q -b main` itself for exactly that reason.
test('BL-1039: the seeded repository is on `main`, whatever the host default branch is', () => {
  const dir = checkoutSeededRepo('bl1039-branch-');
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    assert.equal(branch, 'main');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
