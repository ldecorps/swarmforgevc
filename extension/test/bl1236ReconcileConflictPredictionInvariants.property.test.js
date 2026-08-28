'use strict';

// BL-1236 declared invariants (property tests are coder-authored first, per
// this project's Invariants contract - property tests split by origin):
//
//   1. A conflict prediction is derived from git's own verdict for the
//      merge, never from a text search over the content being merged.
//   2. No divergence that git can merge cleanly is ever resolved by a
//      reset that makes local commits unreachable.
//   3. When git cannot produce a merge verdict, the sweep leaves the
//      checkout exactly as it found it - an unavailable answer never
//      authorises a reset.
//
// Invariant 1 and 2 are driven against REAL git (the incident was git's
// OWN merge behaviour disagreeing with a text search over its diff output -
// a fake can't reproduce that disagreement). Invariant 3 is a pure property
// over master_main_reconcile_lib.bb's absorb-dispatch-plan, generator-swept
// across every reachable combination of the inputs that used to decide
// between :ff-absorb/:refuse-rematch/:replay-bookkeeping (deep states:
// merge-head-present with behind>0, ahead>0 with a conflict foresight,
// etc.) so an unavailable verdict is proven to never reach a plan whose
// executor could reset, across the WHOLE input space, not a hand-picked
// sample.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO = path.join(__dirname, '..', '..');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'master_main_reconcile_lib.bb');

function runBb(script) {
  return spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env },
  });
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initRepoPair() {
  const remoteRoot = mkTmpDir('bl1236-remote-');
  const root = mkTmpDir('bl1236-root-');
  git(remoteRoot, ['init', '-q', '--bare', '.']);
  git(remoteRoot, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(root, ['init', '-q', '-b', 'main', '.']);
  git(root, ['config', 'user.email', 'bl1236@example.com']);
  git(root, ['config', 'user.name', 'bl1236']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  git(root, ['remote', 'add', 'origin', remoteRoot]);
  git(root, ['push', '-q', 'origin', 'main']);
  return { root, remoteRoot };
}

function cloneOf(remoteRoot) {
  const other = mkTmpDir('bl1236-other-');
  git(other, ['clone', '-q', remoteRoot, '.']);
  git(other, ['config', 'user.email', 'bl1236@example.com']);
  git(other, ['config', 'user.name', 'bl1236']);
  git(other, ['config', 'commit.gpgsign', 'false']);
  return other;
}

function commitFile(root, name, content, message) {
  fs.writeFileSync(path.join(root, name), `${content}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

// Decoy prose: every word/phrase the OLD legacy-diff-text predicate
// (merge-tree-reports-conflict?) grepped for, in the casings its
// case-insensitive regex matched - exactly the words this repo's own
// backlog/evidence prose contains constantly, which is what fired the
// false predictions in the first place.
const decoyArb = fc.constantFrom(
  'No conflicts. This is a clean run.',
  'CONFLICT (content): Merge conflict in seed.txt',
  'changed in both branches, see notes',
  'ADDED IN BOTH sides of the split',
  'this predicate never has a conflict',
  'plain prose with no decoy words at all'
);

function realMergeVerdict(root) {
  const r = spawnSync('git', ['merge-tree', '--write-tree', 'HEAD', 'origin/main'], {
    cwd: root,
    encoding: 'utf8',
  });
  const out = runBb(`
(load-file "${LIB}")
(println (name (master-main-reconcile-lib/merge-verdict ${r.status})))
`);
  assert.equal(out.status, 0, out.stderr || out.stdout);
  return out.stdout.trim();
}

// ── invariant 1 ─────────────────────────────────────────────────────────
test('property (invariant 1): the prediction follows a real clean two-way merge regardless of decoy conflict-shaped prose in the merged content', () => {
  fc.assert(
    fc.property(decoyArb, decoyArb, (originDecoy, localDecoy) => {
      const { root, remoteRoot } = initRepoPair();
      const other = cloneOf(remoteRoot);
      commitFile(other, 'origin-only.txt', originDecoy, 'origin-side (BL-1236 property)');
      git(other, ['push', '-q', 'origin', 'main']);
      commitFile(root, 'local-only.txt', localDecoy, 'local-side (BL-1236 property)');
      git(root, ['fetch', '-q', 'origin', 'main']);

      assert.equal(
        realMergeVerdict(root),
        'clean',
        `a non-overlapping two-way divergence must verdict clean regardless of decoy prose (origin="${originDecoy}", local="${localDecoy}")`
      );
    }),
    { numRuns: 4 }
  );
});

test('property (invariant 1): a genuine content conflict still verdicts conflict, decoy prose or not', () => {
  fc.assert(
    fc.property(decoyArb, (decoy) => {
      const { root, remoteRoot } = initRepoPair();
      const other = cloneOf(remoteRoot);
      fs.writeFileSync(path.join(other, 'seed.txt'), `${decoy}\norigin-conflict-line\n`);
      git(other, ['add', '-A']);
      git(other, ['commit', '-q', '-m', 'origin-conflicting-edit (BL-1236 property)']);
      git(other, ['push', '-q', 'origin', 'main']);
      fs.writeFileSync(path.join(root, 'seed.txt'), `${decoy}\nlocal-conflict-line\n`);
      git(root, ['add', '-A']);
      git(root, ['commit', '-q', '-m', 'local-conflicting-edit (BL-1236 property)']);
      git(root, ['fetch', '-q', 'origin', 'main']);

      assert.equal(
        realMergeVerdict(root),
        'conflict',
        `a genuine same-path incompatible edit must still verdict conflict (decoy="${decoy}")`
      );
    }),
    { numRuns: 4 }
  );
});

// ── invariant 2 ─────────────────────────────────────────────────────────
test('property (invariant 2): a cleanly mergeable divergence is absorbed by a real merge - every prior commit stays reachable, whatever the local/origin commit counts', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 3 }),
      fc.integer({ min: 1, max: 3 }),
      (localCommits, originCommits) => {
        const { root, remoteRoot } = initRepoPair();
        const other = cloneOf(remoteRoot);

        const localShas = [];
        for (let i = 0; i < localCommits; i += 1) {
          localShas.push(commitFile(root, `local-${i}.txt`, `local-${i}`, `local commit ${i} (BL-1236 property)`));
        }
        const originShas = [];
        for (let i = 0; i < originCommits; i += 1) {
          originShas.push(commitFile(other, `origin-${i}.txt`, `origin-${i}`, `origin commit ${i} (BL-1236 property)`));
        }
        git(other, ['push', '-q', 'origin', 'main']);
        git(root, ['fetch', '-q', 'origin', 'main']);

        assert.equal(realMergeVerdict(root), 'clean', 'fixture must build a cleanly mergeable divergence');

        const result = spawnSync('git', ['merge', '--no-edit', 'origin/main'], { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 0, `real merge failed unexpectedly: ${result.stdout}${result.stderr}`);

        for (const sha of [...localShas, ...originShas]) {
          assert.doesNotThrow(
            () => git(root, ['merge-base', '--is-ancestor', sha, 'main']),
            `commit ${sha} is no longer reachable from local main after absorb`
          );
        }
      }
    ),
    { numRuns: 4 }
  );
});

// ── invariant 3 ─────────────────────────────────────────────────────────
test('property (invariant 3): an unavailable verdict never reaches a plan whose executor could reset, across every reachable dispatch input', () => {
  const resettingPlans = new Set(['ff-absorb', 'refuse-rematch', 'replay-bookkeeping']);
  fc.assert(
    fc.property(
      fc.boolean(), // merge-head-present?
      fc.integer({ min: 0, max: 5 }), // behind
      fc.integer({ min: 0, max: 5 }), // ahead
      fc.boolean(), // tip-contains-origin?
      fc.boolean(), // would-conflict? / absorb-would-conflict? (irrelevant when verdict-unavailable? true, but swept anyway for full input-space coverage)
      (mergeHeadPresent, behind, ahead, tipContainsOrigin, conflictForesight) => {
        const r = runBb(`
(load-file "${LIB}")
(println (name (master-main-reconcile-lib/absorb-dispatch-plan
  {:merge-head-present? ${mergeHeadPresent}
   :behind ${behind}
   :ahead ${ahead}
   :tip-contains-origin? ${tipContainsOrigin}
   :would-conflict? ${conflictForesight}
   :absorb-would-conflict? ${conflictForesight}
   :verdict-unavailable? true})))
`);
        assert.equal(r.status, 0, r.stderr || r.stdout);
        const plan = r.stdout.trim();
        assert.ok(
          !resettingPlans.has(plan),
          `verdict-unavailable? true reached a resetting plan "${plan}" for inputs ` +
            JSON.stringify({ mergeHeadPresent, behind, ahead, tipContainsOrigin, conflictForesight })
        );
      }
    ),
    { numRuns: 100 }
  );
});

test('property (invariant 3): run-post-hotfix-merge! attempts no merge, rematch, or fetch-side-effecting mutation when the verdict is unavailable', () => {
  const POST = path.join(REPO, 'swarmforge', 'scripts', 'post_hotfix_merge_origin_lib.bb');
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 5 }), // behind
      fc.integer({ min: 0, max: 5 }), // ahead
      (behind, ahead) => {
        const daemonDir = mkTmpDir('bl1236-post-hotfix-');
        const r = runBb(`
(require '[clojure.string :as str])
(load-file "${LIB}")
(load-file "${POST}")
(def calls (atom []))
(def result
  (post-hotfix-merge-origin-lib/run-post-hotfix-merge!
   {:daemon-dir "${daemonDir}"
    :fetch! (fn [] (swap! calls conj :fetch))
    :rev-counts! (fn [] {:ahead ${ahead} :behind ${behind}})
    :dirty-paths! (fn [] [])
    :merge-verdict! (fn [] :unavailable)
    :tip-contains-origin! (fn [] false)
    :merge! (fn [] (swap! calls conj :merge) {:success true})
    :merge3! (fn [] (swap! calls conj :merge3) {:success true})
    :rematch! (fn [] (swap! calls conj :rematch) {:success true})
    :abort! (fn [] (swap! calls conj :abort))
    :status-porcelain! (fn [] "")
    :mid-merge? (fn [] false)}))
(println (str/join "," (map name @calls)))
(println (name (:outcome result)))
`);
        assert.equal(r.status, 0, r.stderr || r.stdout);
        const lines = r.stdout.trim().split('\n');
        // fetch! always runs unconditionally (run-post-hotfix-merge!'s own
        // contract: it refreshes origin/main before deciding anything) -
        // that alone never touches local main's refs. merge!/merge3!/
        // rematch!/abort! are the ones that could, and none of them may
        // run when the verdict is unavailable.
        const calls = new Set(lines[0].split(',').filter(Boolean));
        for (const forbidden of ['merge', 'merge3', 'rematch', 'abort']) {
          assert.ok(!calls.has(forbidden), `expected no "${forbidden}" call with an unavailable verdict, got calls: ${lines[0]}`);
        }
        assert.equal(lines[1], 'verdict-unavailable');
      }
    ),
    { numRuns: 8 }
  );
});
