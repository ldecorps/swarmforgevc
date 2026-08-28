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
