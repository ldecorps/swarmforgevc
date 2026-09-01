'use strict';

// BL-1315 declared invariants:
//
// 1. No path the landed ticket's own chain delivered is ever dropped from
//    the replay tip, whichever role authored it and whether or not that
//    role's commit names the ticket.
// 2. A path is excluded only on positive attribution to another ticket that
//    is unlanded. An attribution that cannot be read refuses the land - it
//    never silently narrows the tip.
//
// Both drive REAL git repositories through the REAL land_step_lib.bb -
// mocking the git layer could not exhibit either face of the defect this
// ticket fixes, which lives entirely in which commits two different diffs
// draw content from (see land_step_lib.bb's own-paths docstring).
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LAND_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');

const TASK = 'BL-1315-fixture';
const TASK_ID = 'BL-1315';
const SIBLING_IDS = ['BL-9101', 'BL-9102', 'BL-9103'];

function bbEval(script) {
  const result = spawnSync('bb', ['-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, `bb failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined },
  });
}

function writeCommit(root, paths, subject, content) {
  for (const p of paths) {
    const full = path.join(root, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content === undefined ? `${subject}\n${p}\n` : content);
    git(root, 'add', p);
  }
  git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-verify', '-m', subject);
  return git(root, 'rev-parse', 'HEAD').trim();
}

function initRepo(root) {
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@test');
  git(root, 'config', 'user.name', 'test');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'seed');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
}

function withRoot(prefix, fn) {
  const root = mkTmpDir(prefix);
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Reads own-paths' :paths as a sorted list of lines, "NIL" as the distinct
// marker for a refused read - never flattened into an empty list, the same
// distinction land_step_lib.bb's own contract insists on throughout.
function ownPaths(root, commit, unlandedIds) {
  const unlandedSet = unlandedIds.length ? `#{${unlandedIds.map((s) => JSON.stringify(s)).join(' ')}}` : '#{}';
  const out = bbEval(
    `(load-file ${JSON.stringify(LAND_LIB)})
     (let [r (land-step-lib/own-paths ${JSON.stringify(root)} ${JSON.stringify(commit)} ${JSON.stringify(TASK_ID)} ${unlandedSet})]
       (print (if (nil? (:paths r)) "NIL" (clojure.string/join "\\n" (sort (:paths r))))))`
  );
  if (out === 'NIL') return null;
  return out.split('\n').filter(Boolean);
}

// ── invariant 1: an own path is never dropped, tagged or not; a sibling
//    path attributed only to an unlanded ticket is always dropped ─────────

const ownSpecArb = fc.array(fc.record({ tagged: fc.boolean() }), { minLength: 1, maxLength: 3 });
const siblingSpecArb = fc.array(fc.record({ idIdx: fc.integer({ min: 0, max: SIBLING_IDS.length - 1 }) }), {
  minLength: 0,
  maxLength: 3,
});

test('property (invariant 1 and 2): every own path survives, every unlanded-sibling-only path is dropped', () => {
  const seen = { withSiblings: 0, withUntaggedOwn: 0, noSiblings: 0 };
  fc.assert(
    fc.property(ownSpecArb, siblingSpecArb, (ownSpecs, siblingSpecs) => {
      if (siblingSpecs.length > 0) seen.withSiblings += 1;
      else seen.noSiblings += 1;
      if (ownSpecs.some((s) => !s.tagged)) seen.withUntaggedOwn += 1;

      withRoot('sfvc-bl1315-inv1-', (root) => {
        initRepo(root);

        const ownPathsList = ownSpecs.map((_, i) => `own/own${i}.txt`);
        const siblingPathsList = siblingSpecs.map((_, i) => `sibling/sib${i}.txt`);
        const siblingIdsUsed = [...new Set(siblingSpecs.map((s) => SIBLING_IDS[s.idIdx]))];

        if (siblingPathsList.length > 0) {
          git(root, 'checkout', '-q', '-b', 'bl1315-siblings');
          siblingSpecs.forEach((s, i) => {
            writeCommit(root, [siblingPathsList[i]], `${SIBLING_IDS[s.idIdx]}: sibling work ${i}`);
          });
          git(root, 'checkout', '-q', 'main');
        }

        ownSpecs.forEach((s, i) => {
          const subject = s.tagged ? `${TASK}: own work ${i}` : `role: untagged own work ${i}`;
          writeCommit(root, [ownPathsList[i]], subject);
        });

        let commit;
        if (siblingPathsList.length > 0) {
          git(root, '-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', '-q', '--no-verify', '-m', `${TASK}: forward merge`, 'bl1315-siblings');
          commit = git(root, 'rev-parse', 'HEAD').trim();
        } else {
          commit = git(root, 'rev-parse', 'HEAD').trim();
        }

        const result = ownPaths(root, commit, siblingIdsUsed);

        assert.notEqual(result, null, `own-paths refused on a clean, fully-attributed fixture: siblings=${JSON.stringify(siblingSpecs)}`);

        for (const p of ownPathsList) {
          assert.ok(
            result.includes(p),
            `invariant 1 violated - an own path was dropped: ${p} not in ${JSON.stringify(result)} (ownSpecs=${JSON.stringify(ownSpecs)})`
          );
        }
        for (const p of siblingPathsList) {
          assert.ok(
            !result.includes(p),
            `invariant 2 violated - a path attributable only to an unlanded sibling was kept: ${p} in ${JSON.stringify(result)}`
          );
        }
        assert.equal(
          result.length,
          ownPathsList.length,
          `own-paths returned more than the own paths: ${JSON.stringify(result)} vs own=${JSON.stringify(ownPathsList)}`
        );
      });
    }),
    { numRuns: 25 }
  );

  assert.ok(seen.withSiblings > 0, `never generated a case with an unlanded sibling: ${JSON.stringify(seen)}`);
  assert.ok(seen.withUntaggedOwn > 0, `never generated an own path whose own commit names no ticket: ${JSON.stringify(seen)}`);
  assert.ok(seen.noSiblings > 0, `never generated a case with no sibling at all: ${JSON.stringify(seen)}`);
});

// ── invariant 2, second sentence: an unreadable attribution refuses rather
//    than narrowing - driven via an injected commits-fn (own-paths' own DI
//    seam) rather than real repository corruption, which cannot isolate a
//    single path's attribution without also breaking its neighbours' (any
//    commit's tree in the walk is needed to decide every later path's
//    TREESAME-ness too) ───────────────────────────────────────────────────

test('property (invariant 2, refusal): an unreadable path refuses the land and names itself, never a readable neighbour', () => {
  fc.assert(
    fc.property(fc.integer({ min: 2, max: 4 }), fc.integer({ min: 0, max: 3 }), (count, pickSeed) => {
      const unreadableIdx = pickSeed % count;
      withRoot('sfvc-bl1315-inv2-refuse-', (root) => {
        initRepo(root);
        const ownPathsList = Array.from({ length: count }, (_, i) => `own/own${i}.txt`);
        ownPathsList.forEach((p, i) => writeCommit(root, [p], `${TASK}: own work ${i}`));
        const commit = git(root, 'rev-parse', 'HEAD').trim();
        const unreadablePath = ownPathsList[unreadableIdx];

        const out = bbEval(`
(load-file ${JSON.stringify(LAND_LIB)})
(require '[clojure.java.shell :as sh])
(require '[clojure.string :as str])
(defn commits-fn [root origin-main commit path]
  (if (= path ${JSON.stringify(unreadablePath)})
    nil
    (let [res (sh/sh "git" "-C" root "log" "--format=%H" (str origin-main ".." commit) "--" path)]
      (when (zero? (:exit res)) (remove str/blank? (str/split-lines (:out res)))))))
(let [r (land-step-lib/own-paths ${JSON.stringify(root)} ${JSON.stringify(commit)} ${JSON.stringify(TASK_ID)} #{} commits-fn)]
  (print (pr-str {:paths (:paths r) :warning (:warning r)})))`);

        assert.match(out, /:paths nil/, `an unreadable path did not refuse: ${out}`);
        assert.ok(out.includes(unreadablePath), `the refusal never named the unreadable path ${unreadablePath}: ${out}`);
        for (const p of ownPathsList) {
          if (p === unreadablePath) continue;
          assert.ok(
            !out.includes(p),
            `the refusal named a READABLE neighbour instead of the actually-unreadable path: ${p} in ${out}`
          );
        }
      });
    }),
    { numRuns: 12 }
  );
});
