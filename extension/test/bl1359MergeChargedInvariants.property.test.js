'use strict';

// BL-1359's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A merge is charged with exactly the QA-exclusive paths it
//                introduced relative to its FIRST parent: never a path whose
//                merge result is byte-identical to that parent, and never
//                fewer paths than that two-tree diff contains.
//   invariant 2  Fail-closed is unchanged (BL-962 invariant 3): any git call
//                that cannot answer still withholds the WHOLE sweep as
//                ancestry-unavailable - a narrowed charge set never becomes a
//                silent clean.
//   invariant 3  Non-merge commits are charged exactly as they are today; only
//                the merge branch of the touched-path read changes.
//
// Drives the REAL swarmforge/scripts/babysitter_check.bb against real git
// fixtures - never a JavaScript restatement of the decision. A stubbed git
// layer could not exhibit the defect at all: it lives entirely in which
// commits a git command draws its diff from.
//
// GENERATOR REACH (by construction, never by draw). The defect needs a merge
// whose result matches its FIRST parent for a path some OTHER parent changed,
// so that shape is built in every case rather than hoped for, and the drawn
// dimensions are the ones that could hide it: how many files the side branch
// carries, and how many of them the merge actually takes. Both extremes -
// the merge taking none of them, and the merge taking all of them - are
// enumerated as well as drawn, because "charged with nothing" and "charged
// with everything" are the two answers this change could wrongly collapse to.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CHECK = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'babysitter_check.bb');
const FIXTURE_PREFIX = 'bl1359-property-';

// A killed run traps no `finally`, so the previous run's fixtures are swept by
// prefix BEFORE this one starts as well (BL-971).
function sweepFixtures() {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
}

function git(root, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD').trim();
}

/** The REAL commit-touched-paths, loaded against this fixture root. */
function touchedPaths(root, sha) {
  const program = `
(require '[cheshire.core :as json])
(binding [*command-line-args* ["${root}"]]
  (load-file "${CHECK}"))
(println (json/generate-string (babysitter-check/commit-touched-paths "${sha}")))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

/** git's own answer for "what did this merge introduce over its first parent". */
function firstParentDelta(root, sha) {
  const p1 = git(root, 'rev-parse', `${sha}^1`).trim();
  return git(root, 'diff-tree', '--no-commit-id', '--name-only', '-r', p1, sha)
    .split('\n')
    .filter(Boolean)
    .sort();
}

/**
 * A merge over `sideFiles`, of which the first `taken` are resolved to the
 * SIDE's version and the rest kept at MAIN's. Every side file exists on both
 * branches with different content, so the union form charges all of them and
 * only the taken ones are genuinely introduced.
 */
function buildFixture(sideFiles, taken) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'README.md'), 'init\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  for (const f of sideFiles) commitFile(root, f, 'base\n', `seed ${f}`);
  git(root, 'branch', 'swarmforge-QA');

  git(root, 'checkout', '-q', '-b', 'side');
  for (const f of sideFiles) commitFile(root, f, 'side version\n', `coder: side ${f}`);
  git(root, 'checkout', '-q', 'main');
  for (const f of sideFiles) commitFile(root, f, 'main version\n', `operator: main ${f}`);
  const firstParent = git(root, 'rev-parse', 'HEAD').trim();

  try {
    git(root, 'merge', '-q', '--no-ff', '--no-commit', 'side');
  } catch {
    // Conflicts are expected - both sides edited every file.
  }
  sideFiles.forEach((f, i) => {
    git(root, 'checkout', i < taken ? '--theirs' : '--ours', '--', f);
  });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'Merge side into main');
  return { root, mergeSha: git(root, 'rev-parse', 'HEAD').trim(), firstParent };
}

const fileNames = (n) => Array.from({ length: n }, (_, i) => `extension/src/mod${i}.ts`);

test('BL-1359/BL-654 invariant 1: a merge is charged with exactly its first-parent delta', () => {
  sweepFixtures();
  const reach = { tookNone: 0, tookAll: 0, tookSome: 0 };

  const check = (count, taken) => {
    const { root, mergeSha } = buildFixture(fileNames(count), taken);
    try {
      const charged = [...touchedPaths(root, mergeSha)].sort();
      const delta = firstParentDelta(root, mergeSha);

      // Exactly, in both directions: never a path the merge did not introduce,
      // and never fewer than the two-tree diff contains.
      assert.deepEqual(charged, delta, `count=${count} taken=${taken}`);

      // Stated the way the invariant is worded, so a deepEqual that drifted
      // could not silently satisfy it.
      for (const p of charged) {
        assert.notEqual(
          git(root, 'diff', `${mergeSha}^1`, mergeSha, '--', p),
          '',
          `${p} is byte-identical to the first parent and must not be charged`
        );
      }
      for (const p of delta) {
        assert.ok(charged.includes(p), `${p} was introduced but is not charged`);
      }

      if (taken === 0) reach.tookNone += 1;
      else if (taken === count) reach.tookAll += 1;
      else reach.tookSome += 1;
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

  // Enumerated extremes: charged-with-nothing and charged-with-everything are
  // the two answers this change could wrongly collapse to.
  check(3, 0);
  check(3, 3);
  check(3, 1);

  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 4 }).chain((n) => fc.tuple(fc.constant(n), fc.integer({ min: 0, max: n }))),
      ([count, taken]) => {
        check(count, taken);
        return true;
      }
    ),
    { numRuns: 4 }
  );

  assert.ok(reach.tookNone > 0 && reach.tookAll > 0 && reach.tookSome > 0, JSON.stringify(reach));
});

test('BL-1359/BL-654 invariant 2: a git call that cannot answer never reads as clean', () => {
  sweepFixtures();
  const reach = { firstParentGone: 0, commitUnknown: 0 };

  // The first parent's tree is gone, so the two-tree diff the charge is
  // computed from cannot run. nil - not [] - is the only safe answer.
  const { root, mergeSha } = buildFixture(fileNames(2), 1);
  try {
    assert.deepEqual([...touchedPaths(root, mergeSha)].sort(), firstParentDelta(root, mergeSha));
    const tree = git(root, 'rev-parse', `${mergeSha}^1^{tree}`).trim();
    fs.rmSync(path.join(root, '.git', 'objects', tree.slice(0, 2), tree.slice(2)), { force: true });
    reach.firstParentGone += 1;
    assert.equal(
      touchedPaths(root, mergeSha),
      null,
      'a merge whose first-parent diff cannot run must answer nil, never an empty charge set'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const fx = buildFixture(fileNames(1), 1);
  try {
    reach.commitUnknown += 1;
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9a-f]{40}$/), (sha) => {
        assert.equal(touchedPaths(fx.root, sha), null, `an unresolvable sha must answer nil, not clean`);
        return true;
      }),
      { numRuns: 5 }
    );
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }

  assert.ok(reach.firstParentGone > 0 && reach.commitUnknown > 0, JSON.stringify(reach));
});

test('BL-1359/BL-654 invariant 3: non-merge commits are charged exactly as before', () => {
  sweepFixtures();
  const { root, firstParent } = buildFixture(fileNames(2), 1);
  try {
    fc.assert(
      fc.property(fc.constant(firstParent), (sha) => {
        // A non-merge commit's charge is its own single-parent diff, which is
        // precisely what the untouched branch of the read returns.
        const charged = [...touchedPaths(root, sha)].sort();
        const own = git(root, 'diff-tree', '--no-commit-id', '--name-only', '-r', sha)
          .split('\n')
          .filter(Boolean)
          .sort();
        assert.deepEqual(charged, own);
        assert.ok(charged.length > 0, 'the fixture must give the non-merge commit something to charge');
        return true;
      }),
      { numRuns: 3 }
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
