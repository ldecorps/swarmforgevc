'use strict';

// BL-1230 D1 (architect bounce, backlog/evidence/BL-1230-architect-bounce-20260828.md):
// the ticket's two declared invariants had no executable property test.
// Both are encoded here against arbitrarily-generated in-memory tree
// layouts, via findNestedGitRepositories's injectable `readdir` seam - no
// real filesystem or `git` spawn needed.

const assert = require('node:assert/strict');
const path = require('node:path');
const fc = require('fast-check');
const { findNestedGitRepositories } = require('./helpers/nestedGitRepoGuard');

// A tree is a plain object: { name, type: 'dir' | 'gitDir' | 'gitFile' | 'file', children: [...] }.
// 'gitDir' is a real nested `.git` DIRECTORY (a leak candidate); 'gitFile' is
// a `.git` FILE (worktree gitfile / submodule reference), exempt by
// construction and never a directory.
const leafArb = fc.oneof(
  fc.record({ name: fc.constant('.git'), type: fc.constant('gitFile') }),
  fc.record({ name: fc.stringMatching(/^[a-zA-Z0-9_-]{1,8}$/), type: fc.constant('file') })
);

// A real directory can never hold two entries with the same name - every
// sibling array is generated via fc.uniqueArray keyed on `name` (never
// plain fc.array), or a duplicate-name collision corrupts the fixture's
// path-keyed lookup (buildFixture below) with an invalid state no real
// filesystem could produce, generating spurious counterexamples unrelated
// to the guard under test.
function uniqueChildren(childArb, maxLength) {
  return fc.uniqueArray(childArb, { selector: (c) => c.name, maxLength });
}

function dirArb(depth) {
  const childArb =
    depth <= 0
      ? leafArb
      : fc.oneof(
          { arbitrary: leafArb, weight: 3 },
          { arbitrary: fc.record({ name: fc.constant('.git'), type: fc.constant('gitDir'), children: fc.constant([]) }), weight: 2 },
          { arbitrary: fc.record({ name: fc.constant('node_modules'), type: fc.constant('dir'), children: uniqueChildren(childArbAtDepth(depth - 1), 3) }), weight: 1 },
          { arbitrary: fc.record({ name: fc.constant('.worktrees'), type: fc.constant('dir'), children: uniqueChildren(childArbAtDepth(depth - 1), 3) }), weight: 1 },
          { arbitrary: dirArb(depth - 1), weight: 2 }
        );
  return fc.record({
    name: fc.stringMatching(/^[a-zA-Z0-9_-]{1,8}$/),
    type: fc.constant('dir'),
    children: uniqueChildren(childArb, 4),
  });
}

function childArbAtDepth(depth) {
  return depth <= 0 ? leafArb : dirArb(depth);
}

// The generated forest under root: an array of top-level entries (root's
// OWN .git is added separately by the caller, never generated here, so the
// generator can never accidentally produce the one entry that must NOT be
// reported). Unique by name for the same reason as every sibling array above.
const forestArb = uniqueChildren(dirArb(2), 4);

/** Builds an injectable readdir() over the generated forest, plus the exact
 *  set of relative .git-DIRECTORY paths the invariant says must be reported
 *  (computed independently of the module under test, by direct tree walk). */
function buildFixture(forest) {
  const nodesByPath = new Map(); // 'a/b' -> node (dir/gitDir children arrays)
  const expected = [];

  function index(nodes, relDir) {
    for (const node of nodes) {
      const rel = relDir ? `${relDir}/${node.name}` : node.name;
      if (node.type === 'gitDir') {
        // Skip if this is inside node_modules/.worktrees - reachability is
        // controlled by whether index() ever recurses into those dirs below.
        expected.push(rel);
      } else if (node.type === 'dir') {
        nodesByPath.set(rel, node.children);
        if (node.name !== 'node_modules' && node.name !== '.worktrees') {
          index(node.children, rel);
        }
        // node_modules/.worktrees children are never walked by the real
        // guard either, so their descendants (including any gitDir) must
        // NOT appear in `expected` - deliberately not indexed.
      }
      // 'file' and 'gitFile' entries contribute nothing further.
    }
  }
  index(forest, '');
  nodesByPath.set('', forest);

  function readdir(dir, root) {
    const rel = path.relative(root, dir).split(path.sep).join('/');
    const key = rel === '.' || rel === '' ? '' : rel;
    const nodes = nodesByPath.get(key);
    if (nodes === undefined) {
      throw new Error(`ENOENT (fixture): ${dir}`);
    }
    // P2 deliberately hands back the SAME node objects (not copies), with
    // isDirectory attached in place - a function, so JSON.stringify still
    // ignores it. This makes the "input unchanged after the call" property
    // sensitive to a walk() that renamed, deleted, or reordered entries via
    // its readdir result, not merely to a walk() that never touches
    // `forest` because every entry it saw was already a disposable copy.
    for (const node of nodes) {
      if (typeof node.isDirectory !== 'function') {
        node.isDirectory = () => node.type === 'dir' || node.type === 'gitDir';
      }
    }
    return nodes;
  }

  return { readdir, expected: expected.sort() };
}

test('BL-1230 P1: reports exactly the .git DIRECTORY paths outside node_modules/.worktrees, never root\'s own', () => {
  fc.assert(
    fc.property(forestArb, (forest) => {
      const root = '/repo';
      const { readdir, expected } = buildFixture(forest);
      const boundReaddir = (dir, opts) => readdir(dir, root);
      const violations = findNestedGitRepositories(root, { readdir: boundReaddir });
      const reported = violations.map((v) => v.path).sort();
      assert.deepEqual(reported, expected);
      // Root's own .git is never generated by forestArb and never appears
      // in violations - the exemption is structural, not a special case
      // the property could vacuously pass by never exercising it, since
      // this assertion holds across every generated forest including empty
      // ones.
      assert.ok(!reported.includes('.git') || expected.includes('.git'));
    }),
    { numRuns: 200 }
  );
});

test('BL-1230 P2: the call never mutates the input tree structure', () => {
  fc.assert(
    fc.property(forestArb, (forest) => {
      const root = '/repo';
      const before = JSON.stringify(forest);
      const { readdir } = buildFixture(forest);
      const boundReaddir = (dir, opts) => readdir(dir, root);
      findNestedGitRepositories(root, { readdir: boundReaddir });
      assert.equal(JSON.stringify(forest), before);
    }),
    { numRuns: 200 }
  );
});

// Non-vacuity (break-then-fix discipline): P1 must actually fail if the
// guard's exemption logic breaks. Simulated here by asserting against a
// DELIBERATELY WRONG expected set for a fixed, known-nonempty fixture,
// proving the property is sensitive to the guard's real output rather than
// passing regardless of what findNestedGitRepositories returns.
test('BL-1230 P1 non-vacuity: the property fails against a deliberately wrong expectation', () => {
  const root = '/repo';
  const forest = [{ name: 'a', type: 'dir', children: [{ name: '.git', type: 'gitDir', children: [] }] }];
  const { readdir } = buildFixture(forest);
  const boundReaddir = (dir) => readdir(dir, root);
  const violations = findNestedGitRepositories(root, { readdir: boundReaddir });
  const reported = violations.map((v) => v.path).sort();
  assert.deepEqual(reported, ['a/.git']);
  assert.throws(() => assert.deepEqual(reported, []));
});

// ── BL-1246: the git-ignored-directory exemption ────────────────────────
//
// Invariant 1 widens with a fourth exemption ("anything inside a directory
// this working tree's git ignores"), invariant 2 is new: the exemption must
// never silence a real leak beside it.
//
// Generator reach: the failure both invariants guard against lives at the
// boundary between an ignored subtree and a tracked one, so a tree with only
// one kind reaches nothing. Every generated tree therefore CONTAINS both by
// construction - a tracked branch and an ignored branch, each able to hold
// leaks - rather than drawing two independent trees and hoping one of each
// appears. The counts of leaks on either side are drawn independently and
// both sides' non-empty states carry asserted floors, so a draw that stopped
// producing tracked leaks (which would make invariant 2 vacuous) turns the
// test red instead.

const IGNORED_ROOT = 'tmp';

// A leak-bearing subtree: `count` directories, each containing a `.git` DIR.
function leakDirs(count, prefix) {
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix}${i}`,
    type: 'dir',
    children: [{ name: '.git', type: 'gitDir', children: [] }],
  }));
}

/** readdir + isIgnored over a tree with one ignored branch and one tracked. */
function buildIgnoreFixture(root, ignoredLeaks, trackedLeaks) {
  const forest = [
    { name: IGNORED_ROOT, type: 'dir', children: leakDirs(ignoredLeaks, 'scratch') },
    { name: 'backlog', type: 'dir', children: leakDirs(trackedLeaks, 'leak') },
  ];
  const { readdir } = buildFixture(forest);
  const expected = Array.from({ length: trackedLeaks }, (_, i) => `backlog/leak${i}/.git`).sort();
  return {
    readdir: (dir) => readdir(dir, root),
    // Exactly what git would answer for this layout: everything at or below
    // the ignored root, nothing else.
    isIgnored: (dir) => {
      const rel = path.relative(root, dir).split(path.sep).join('/');
      return rel === IGNORED_ROOT || rel.startsWith(`${IGNORED_ROOT}/`);
    },
    expected,
  };
}

test('BL-1246 P3: an ignored subtree is exempt and a tracked leak beside it is still reported', () => {
  let sawIgnoredLeaks = 0;
  let sawTrackedLeaks = 0;
  let sawBoth = 0;
  fc.assert(
    fc.property(fc.nat({ max: 4 }), fc.nat({ max: 4 }), (ignoredLeaks, trackedLeaks) => {
      const root = '/repo';
      const { readdir, isIgnored, expected } = buildIgnoreFixture(root, ignoredLeaks, trackedLeaks);
      const reported = findNestedGitRepositories(root, { readdir, isIgnored })
        .map((v) => v.path)
        .sort();
      // Invariant 1: nothing inside the ignored directory is ever reported.
      for (const violation of reported) {
        assert.ok(
          !violation.startsWith(`${IGNORED_ROOT}/`),
          `a repository inside the ignored directory was reported: ${violation}`
        );
      }
      // Invariant 2: every tracked leak is still reported, however many
      // ignored ones sit beside it.
      assert.deepEqual(reported, expected);
      if (ignoredLeaks > 0) sawIgnoredLeaks += 1;
      if (trackedLeaks > 0) sawTrackedLeaks += 1;
      if (ignoredLeaks > 0 && trackedLeaks > 0) sawBoth += 1;
    }),
    { numRuns: 200 }
  );
  // Reachability floors, asserted rather than hoped for. The third is the one
  // that matters: a run that never generated BOTH kinds at once would pass
  // this property while saying nothing about invariant 2.
  assert.ok(sawIgnoredLeaks > 40, `expected ignored leaks to be drawn, saw ${sawIgnoredLeaks}`);
  assert.ok(sawTrackedLeaks > 40, `expected tracked leaks to be drawn, saw ${sawTrackedLeaks}`);
  assert.ok(sawBoth > 30, `expected trees carrying BOTH kinds, saw ${sawBoth}`);
});

test('BL-1246 P4: the exemption is derived from the predicate, never from a directory name', () => {
  // Same tree, same names, opposite answers from git: what is exempt must
  // follow the predicate and nothing else. A guard that special-cased "tmp"
  // would pass the property above and fail this one.
  let sawIgnoring = 0;
  let sawNotIgnoring = 0;
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 4 }), fc.boolean(), (leaks, ignoring) => {
      const root = '/repo';
      const { readdir } = buildIgnoreFixture(root, leaks, 0);
      const reported = findNestedGitRepositories(root, {
        readdir,
        isIgnored: () => ignoring,
      })
        .map((v) => v.path)
        .sort();
      const expected = Array.from({ length: leaks }, (_, i) => `${IGNORED_ROOT}/scratch${i}/.git`).sort();
      assert.deepEqual(reported, ignoring ? [] : expected);
      ignoring ? (sawIgnoring += 1) : (sawNotIgnoring += 1);
    }),
    { numRuns: 160 }
  );
  assert.ok(sawIgnoring > 40, `expected ignoring draws, saw ${sawIgnoring}`);
  assert.ok(sawNotIgnoring > 40, `expected non-ignoring draws, saw ${sawNotIgnoring}`);
});
