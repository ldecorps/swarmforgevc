'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1297 declared invariants:
//
// 1. A commit's own changed paths are computed against its first parent for
//    every commit shape; a merge never reports an empty change set merely
//    because it is a merge.
// 2. An empty change set is only ever the truth, never an artefact of how the
//    diff was invoked - the three callers sharing this walk answer the same
//    question about the same commit identically.
//
// Both drive REAL git repositories through the REAL bb libraries. Nothing
// here re-implements the walk under test, and neither property compares the
// answer against another `git diff-tree` invocation - the expected path set
// is CONSTRUCTED by the generator, so the oracle is independent of the
// command the implementation happens to choose.
//
// Generator reach (invariant 1's own failure shape): the shapes are drawn
// from an explicit list, and every one of them - crucially the merge shapes,
// which are the ONLY ones that can detect the defect - has an asserted reach
// floor. Drawing "some random commit" would produce a merge almost never.
//
// Runs ONLY via `npm run test:properties`.

const REPO_ROOT = path.join(__dirname, '..', '..');
const GATE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'task_scope_gate_lib.bb');
const LAND_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const UNREG_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'unregistered_test_gate_lib.bb');

const TASK = 'BL-1174-fixture';
const TASK_ID = 'BL-1174';
const OTHER = 'BL-9999-other';

function bbEval(script) {
  const result = spawnSync('bb', ['-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, `bb failed: ${result.stderr}`);
  return result.stdout.trim();
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
    fs.writeFileSync(full, content === undefined ? `${subject}\n` : content);
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
  return git(root, 'rev-parse', 'HEAD').trim();
}

// Every shape the pipeline actually produces, plus the two the defect hides
// behind: a merge (the normal shape of a role's own commit) and a merge whose
// first-parent change is GENUINELY empty - the case that separates "empty
// because it is a merge" from "empty because nothing changed".
const SHAPES = ['single-parent', 'merge', 'octopus-merge', 'empty-merge', 'root'];

// Builds `shape` at the tip of `root` under `subject`, and returns the paths
// that commit changed against its FIRST parent - constructed, not measured.
function buildShape(root, shape, subject, parcelPaths, trunkPath) {
  if (shape === 'single-parent') {
    writeCommit(root, parcelPaths, subject);
    return parcelPaths;
  }
  if (shape === 'root') {
    git(root, 'checkout', '-q', '--orphan', 'bl1297-orphan');
    // Nothing to unstage when the branch point was an empty seed commit.
    if (git(root, 'ls-files').trim() !== '') git(root, 'rm', '-rqf', '--cached', '.');
    for (const f of fs.readdirSync(root)) {
      if (f !== '.git') fs.rmSync(path.join(root, f), { recursive: true, force: true });
    }
    writeCommit(root, parcelPaths, subject);
    return parcelPaths;
  }
  if (shape === 'empty-merge') {
    // The branch and the trunk reach byte-identical content independently, so
    // the merge really does change nothing against its first parent. An empty
    // answer here is the TRUTH, and must stay empty.
    git(root, 'checkout', '-q', '-b', 'bl1297-same');
    writeCommit(root, parcelPaths, `${OTHER}: same content on the branch`, 'identical\n');
    git(root, 'checkout', '-q', 'main');
    writeCommit(root, parcelPaths, `${OTHER}: same content on the trunk`, 'identical\n');
    git(root, '-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', '-q', '--no-verify', '-m', subject, 'bl1297-same');
    return [];
  }
  // merge / octopus-merge: the parcel arrives THROUGH the merge, while
  // trunkPath is already on the first parent under another ticket's subject -
  // so a per-parent union (-m) would name trunkPath and the first-parent diff
  // does not. The two answers are distinguishable by construction.
  const branches = shape === 'octopus-merge' ? 2 : 1;
  const perBranch = [];
  for (let i = 0; i < branches; i += 1) {
    git(root, 'checkout', '-q', 'main');
    git(root, 'checkout', '-q', '-b', `bl1297-branch-${i}`);
    const mine = parcelPaths.filter((_, idx) => idx % branches === i);
    // Every branch must carry at least one path or git makes no commit.
    const carried = mine.length > 0 ? mine : [parcelPaths[0]];
    writeCommit(root, carried, `${OTHER}: ${carried.join(' ')} arriving through the merge`);
    perBranch.push(carried);
  }
  git(root, 'checkout', '-q', 'main');
  writeCommit(root, [trunkPath], `${OTHER}: ${trunkPath} already on the receiving branch`);
  git(
    root,
    '-c',
    'core.hooksPath=/dev/null',
    'merge',
    '--no-ff',
    '-q',
    '--no-verify',
    '-m',
    subject,
    ...perBranch.map((_, i) => `bl1297-branch-${i}`)
  );
  return [...new Set(perBranch.flat())];
}

const PARCEL_PATHS = () =>
  fc
    .uniqueArray(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 3 })
    .map((ns) => ns.map((n) => `extension/src/parcel${n}.ts`).sort());

// nil (the walk could not run) is reported as the distinct marker NIL, never
// flattened into the empty list - telling those two apart is the whole point
// of the contract this ticket is repairing.
function ownPaths(root, commit) {
  const out = bbEval(
    `(load-file ${JSON.stringify(GATE_LIB)})
     (let [r (task-scope-gate-lib/own-commit-changed-paths ${JSON.stringify(root)} ${JSON.stringify(commit)})]
       (print (if (nil? r) "NIL" (clojure.string/join "\\n" r))))`
  );
  if (out === 'NIL') return null;
  return out.split('\n').filter(Boolean);
}

function withRoot(prefix, fn) {
  const root = mkTmpDir(prefix);
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('property (invariant 1): a commit reports its first-parent change for every commit shape', () => {
  const seen = Object.fromEntries(SHAPES.map((s) => [s, 0]));
  const runCase = (shape, parcelPaths) => {
    seen[shape] += 1;
    withRoot('sfvc-bl1297-inv1-', (root) => {
      initRepo(root);
      const expected = buildShape(root, shape, `${TASK}: the parcel`, parcelPaths, 'extension/src/trunk.ts');
      const commit = git(root, 'rev-parse', 'HEAD').trim();
      const actual = ownPaths(root, commit);
      assert.deepEqual(
        [...actual].sort(),
        [...expected].sort(),
        `${shape} reported ${JSON.stringify(actual)}, its first-parent change is ${JSON.stringify(expected)}`
      );
      // The headline half, stated separately so it cannot be satisfied by a
      // shape that happens to have no paths: a merge that DID change
      // something is never empty.
      if (expected.length > 0) {
        assert.ok(actual.length > 0, `${shape} reported an empty change set for a commit that changed ${expected}`);
      }
    });
  };

  // Reach is CONSTRUCTED, not hoped for: every shape is run once outright,
  // and the random runs below add breadth on top. A purely random draw over
  // five shapes really does miss one at these run counts - this file's own
  // first green run missed `empty-merge`, which is the shape that separates
  // an honest empty answer from the defect's artefact.
  for (const shape of SHAPES) runCase(shape, ['extension/src/parcel0.ts']);

  fc.assert(
    fc.property(fc.constantFrom(...SHAPES), PARCEL_PATHS(), runCase),
    { numRuns: 15 }
  );
  for (const shape of SHAPES) {
    assert.ok(seen[shape] > 0, `generator never reached ${shape}: ${JSON.stringify(seen)}`);
  }
  // The shapes the defect hides behind carry the whole property; a run that
  // only ever saw single-parent commits would pass against the defect.
  assert.ok(seen.merge + seen['octopus-merge'] >= 2, `too few merge shapes: ${JSON.stringify(seen)}`);
});

// ── invariant 2: the three callers answer identically ──────────────────────

// The manifest caller 3 reads. Empty (header only) so that any test file the
// parcel introduces is unregistered - which is how caller 3's answer becomes
// observable at all.
function writeManifest(root) {
  const dir = path.join(root, 'swarmforge', 'scripts', 'test');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'suite-manifest.tsv'), 'file\tlane\tdate\treason\n');
}

// One bb process, three answers, so the comparison cannot drift on library
// load order and the property stays affordable.
function threeCallers(root, commit) {
  const out = bbEval(`
(load-file ${JSON.stringify(LAND_LIB)})
(load-file ${JSON.stringify(UNREG_LIB)})
(let [gate (task-scope-gate-lib/parcel-own-changed-paths ${JSON.stringify(root)} ${JSON.stringify(TASK_ID)} ${JSON.stringify(commit)})
      land (land-step-lib/own-paths ${JSON.stringify(root)} ${JSON.stringify(commit)} ${JSON.stringify(TASK_ID)})
      unreg (unregistered-test-gate-lib/findings-for-git-handoff
             {:root ${JSON.stringify(root)} :task-name ${JSON.stringify(TASK)} :commit ${JSON.stringify(commit)}})]
  (print (pr-str {:gate (vec (sort gate)) :land (vec (sort land))
                  :unreg-files (vec (sort (map :file (:findings unreg))))
                  :unreg-warning (some? (:warning unreg))})))`);
  return out;
}

const INV2_SHAPES = ['merge', 'octopus-merge', 'empty-merge', 'single-parent'];

test('property (invariant 2): an empty answer is the truth, and the three callers never disagree', () => {
  const seen = { emptyTruth: 0, nonEmpty: 0, withTestFile: 0 };
  const runCase = (shape, addTestFile) => {
        withRoot('sfvc-bl1297-inv2-', (root) => {
          initRepo(root);
          writeManifest(root);
          git(root, 'add', 'swarmforge');
          git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-verify', '-m', `${OTHER}: manifest`);
          // Both callers' bases are pinned to the SAME boundary, so a
          // disagreement can only come from the walk itself: the gate reads
          // the handoff archive (absent here, so it walks the cited commit),
          // and the land step reads origin/main.
          const base = git(root, 'rev-parse', 'HEAD').trim();
          git(root, 'update-ref', 'refs/remotes/origin/main', base);

          const parcelPaths = addTestFile
            ? ['extension/src/parcel1.ts', 'swarmforge/scripts/test/test_bl1297_fixture.sh']
            : ['extension/src/parcel1.ts'];
          const expected = buildShape(root, shape, `${TASK}: the parcel`, parcelPaths, 'extension/src/trunk.ts');
          const commit = git(root, 'rev-parse', 'HEAD').trim();

          if (expected.length === 0) seen.emptyTruth += 1;
          else seen.nonEmpty += 1;
          if (addTestFile && expected.length > 0) seen.withTestFile += 1;

          const raw = threeCallers(root, commit);
          assert.ok(!raw.includes(':unreg-warning true'), `caller 3 could not read the parcel: ${raw}`);

          const gate = raw.match(/:gate \[([^\]]*)\]/)[1];
          const land = raw.match(/:land \[([^\]]*)\]/)[1];
          assert.equal(gate, land, `caller 1 and caller 2 disagree about ${shape}: ${raw}`);

          const gatePaths = gate ? gate.split(' ').map((s) => JSON.parse(s)) : [];
          assert.deepEqual([...gatePaths].sort(), [...expected].sort(), `the walk misreports ${shape}: ${raw}`);

          // Caller 3 asks the same question through the same seam: it sees
          // the parcel's unregistered test file exactly when the parcel's own
          // change set contains one. An empty artefact here silently ships an
          // invisible test, which is the same fail-open one door down.
          const expectsFinding = expected.includes('swarmforge/scripts/test/test_bl1297_fixture.sh');
          assert.equal(
            raw.includes('test_bl1297_fixture.sh'),
            expectsFinding,
            `caller 3 disagrees with the shared walk about ${shape}: ${raw}`
          );
        });
  };

  // Same constructed reach as invariant 1: the genuinely-empty merge and the
  // test-file case are each run outright before any random draw, because
  // those two are exactly what this property exists to separate.
  for (const shape of INV2_SHAPES) {
    runCase(shape, true);
    runCase(shape, false);
  }
  fc.assert(fc.property(fc.constantFrom(...INV2_SHAPES), fc.boolean(), runCase), { numRuns: 8 });

  assert.ok(seen.emptyTruth > 0, `generator never produced a genuinely empty change set: ${JSON.stringify(seen)}`);
  assert.ok(seen.nonEmpty > 0, `generator never produced a non-empty change set: ${JSON.stringify(seen)}`);
  assert.ok(seen.withTestFile > 0, `caller 3 was never given a test file to find: ${JSON.stringify(seen)}`);
});
