'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { propertyLaneTimeoutMs } = require('./helpers/propertyLaneContentionBudget');

// BL-1297 declared invariants (as amended 2026-08-30):
//
// 1. A merge's DELIVERED paths are its first-parent delta and are never empty
//    merely because it is a merge; its AUTHORED paths are what differ from
//    EVERY parent, and are empty exactly when the merge resolved nothing
//    itself.
// 2. An empty change set is only ever the truth, never an artefact of how the
//    diff was invoked.
// 3. Each caller reads the question its own decision needs: the land-step
//    replay reads DELIVERED, the send-time scope gate and the
//    unregistered-test gate read AUTHORED.
//
// The first version of this contract asserted that all three callers answer
// the SAME question identically. That premise was false and refused every
// forward in the pipeline the moment a branch had synced main - which is
// always. Invariant 3 is now the opposite assertion, and `evil-merge` is the
// shape that keeps it honest: it is the only merge whose author wrote
// something, so it is the only merge on which AUTHORED may be non-empty.
//
// BL-1315 amendment: land_step_lib.bb's own-paths no longer answers
// DELIVERED as this file measures it (the tagged commit's first-parent
// diff) - it answers the FULL origin/main..tip diff minus whatever is
// attributable only to another, unlanded ticket. In every INV3 fixture
// below, the only content ever tagged with TASK's own id is the merge
// commit itself, and everything else (TRUNK, the branch's carried content)
// is tagged OTHER - a real, unlanded ticket id - so it is now excluded the
// same way a genuine sibling's content is. What is left is exactly what the
// merge commit itself authored, so the land assertion below now reads
// `authored`, not `delivered`.
//
// All three drive REAL git repositories through the REAL bb libraries.
// Nothing here re-implements the walk under test, and no property compares
// the answer against another `git diff-tree` invocation - both expected sets
// are CONSTRUCTED by the generator, so the oracle is independent of the
// command the implementation happens to choose.
//
// BL-1564: each invariant answers its whole batch of cases in ONE bb process
// that loads the library once, instead of one bb process per fixture case
// (98 per run, unaffordable inside the full property lane). Every case's
// fixture repository is built FIRST (and kept until the batch has answered -
// cleanup moves to a `finally` over the whole set), then the batch is
// answered in a single `bb -e` call. Shrinking is lost as a result - the
// random draws are pulled with `fc.sample` and a logged seed instead of
// `fc.assert`/`fc.property`, so a failure is replayable from the seed
// printed alongside the reach map, and every assertion carries the failing
// case's own shape/paths in its message.
//
// Runs ONLY via `npm run test:properties`.

const REPO_ROOT = path.join(__dirname, '..', '..');
const GATE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'task_scope_gate_lib.bb');
const LAND_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const UNREG_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'unregistered_test_gate_lib.bb');

const TASK = 'BL-1174-fixture';
const TASK_ID = 'BL-1174';
const OTHER = 'BL-9999-other';
const RIDER = 'extension/src/rider.ts';
const TRUNK = 'extension/src/trunk.ts';

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

// Every shape the pipeline actually produces, plus the three the defect and
// its over-correction hide behind: a clean merge (the normal shape of a
// role's own commit, and the shape whose AUTHORED set must be empty), a merge
// whose first-parent change is GENUINELY empty, and an evil merge - the only
// merge whose author wrote anything.
const SHAPES = ['single-parent', 'merge', 'octopus-merge', 'empty-merge', 'evil-merge', 'root'];

// Builds `shape` at the tip of `root` under `subject`, and returns BOTH
// constructed answers: what the commit delivers against its first parent, and
// what its own author wrote. Constructed, never measured.
function buildShape(root, shape, subject, parcelPaths) {
  if (shape === 'single-parent') {
    writeCommit(root, parcelPaths, subject);
    return { delivered: parcelPaths, authored: parcelPaths };
  }
  if (shape === 'root') {
    git(root, 'checkout', '-q', '--orphan', 'bl1297-orphan');
    // Nothing to unstage when the branch point was an empty seed commit.
    if (git(root, 'ls-files').trim() !== '') git(root, 'rm', '-rqf', '--cached', '.');
    for (const f of fs.readdirSync(root)) {
      if (f !== '.git') fs.rmSync(path.join(root, f), { recursive: true, force: true });
    }
    writeCommit(root, parcelPaths, subject);
    // A root commit has no parent at all, so every path in it is both.
    return { delivered: parcelPaths, authored: parcelPaths };
  }
  if (shape === 'empty-merge') {
    // The branch and the trunk reach byte-identical content independently, so
    // the merge really does change nothing against its first parent. An empty
    // answer here is the TRUTH under both semantics, and must stay empty.
    git(root, 'checkout', '-q', '-b', 'bl1297-same');
    writeCommit(root, parcelPaths, `${OTHER}: same content on the branch`, 'identical\n');
    git(root, 'checkout', '-q', 'main');
    writeCommit(root, parcelPaths, `${OTHER}: same content on the trunk`, 'identical\n');
    git(root, '-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', '-q', '--no-verify', '-m', subject, 'bl1297-same');
    return { delivered: [], authored: [] };
  }
  if (shape === 'evil-merge') {
    // The merge's OWN resolution writes `resolved` - content on neither
    // parent. That is the merger's authorship, and the only case in which a
    // merge's AUTHORED set may be non-empty.
    const resolved = parcelPaths[parcelPaths.length - 1];
    const carried = [...parcelPaths.slice(0, -1), RIDER];
    git(root, 'checkout', '-q', '-b', 'bl1297-evil');
    writeCommit(root, carried, `${OTHER}: ${carried.join(' ')} arriving through the merge`);
    git(root, 'checkout', '-q', 'main');
    writeCommit(root, [TRUNK], `${OTHER}: ${TRUNK} already on the receiving branch`);
    git(root, '-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', '-q', '--no-verify', '--no-commit', 'bl1297-evil');
    const full = path.join(root, resolved);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'resolved in the merge itself\n');
    git(root, 'add', resolved);
    git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-verify', '-m', subject);
    return { delivered: [...new Set([...carried, resolved])], authored: [resolved] };
  }
  // merge / octopus-merge: the parcel arrives THROUGH the merge, while TRUNK
  // is already on the first parent under another ticket's subject - so a
  // per-parent union (-m) would name TRUNK and the first-parent diff does
  // not. The merge resolves nothing itself, so its AUTHORED set is empty:
  // this is the ordinary receive-merge every stage is required to make.
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
  writeCommit(root, [TRUNK], `${OTHER}: ${TRUNK} already on the receiving branch`);
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
  return { delivered: [...new Set(perBranch.flat())], authored: [] };
}

const PARCEL_PATHS = () =>
  fc
    .uniqueArray(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 3 })
    .map((ns) => ns.map((n) => `extension/src/parcel${n}.ts`).sort());

function newSeed() {
  return (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
}

function ednCases(pairs) {
  return pairs.map(({ root, commit }) => `{:root ${JSON.stringify(root)} :commit ${JSON.stringify(commit)}}`).join(' ');
}

// ONE bb process answers `:delivered` and `:authored` for every {root,
// commit} pair in `pairs` - own-commit-changed-paths loaded once instead of
// once per case per semantic (BL-1564). nil stays nil (JSON null), never
// flattened into []: telling an unreadable commit apart from a genuinely
// empty answer is the whole point of invariant 2.
function ownPathsBatch(pairs) {
  const out = bbEval(
    `(load-file ${JSON.stringify(GATE_LIB)})
     (require '[cheshire.core :as json])
     (let [cases [${ednCases(pairs)}]]
       (println (json/generate-string
         (mapv (fn [{:keys [root commit]}]
                 {:delivered (task-scope-gate-lib/own-commit-changed-paths root commit :delivered)
                  :authored (task-scope-gate-lib/own-commit-changed-paths root commit :authored)})
               cases))))`
  );
  return JSON.parse(out.split('\n').pop()).map(({ delivered, authored }) => ({
    delivered: delivered === null ? null : [...delivered].sort(),
    authored: authored === null ? null : [...authored].sort(),
  }));
}

// ONE bb process answers all three callers (the land-step replay, the
// send-time scope gate, the unregistered-test gate) for every {root, commit}
// pair - `threeCallers`'s own one-process-three-answers form (BL-1297),
// generalised over a vector of pairs instead of one process per case
// (BL-1564).
// `gate` and `land` are coerced with `(vec (sort ...))` INSIDE the bb script,
// exactly as the original single-case `threeCallers` did - own-paths (BL-1343)
// legitimately answers nil for a refusal (every delivered path attributed to
// an unlanded sibling, which every non-evil INV3 shape's OTHER-tagged content
// triggers), and the pre-existing contract this ticket must not touch reads
// that refusal the same as a genuine empty answer. Preserving that coercion
// keeps every existing assertion's meaning identical to before BL-1564.
function threeCallersBatch(pairs) {
  const out = bbEval(
    `(load-file ${JSON.stringify(LAND_LIB)})
     (load-file ${JSON.stringify(UNREG_LIB)})
     (require '[cheshire.core :as json])
     (let [cases [${ednCases(pairs)}]]
       (println (json/generate-string
         (mapv (fn [{:keys [root commit]}]
                 (let [gate (task-scope-gate-lib/parcel-own-changed-paths root ${JSON.stringify(TASK_ID)} commit)
                       land (:paths (land-step-lib/own-paths root commit ${JSON.stringify(TASK_ID)}))
                       unreg (unregistered-test-gate-lib/findings-for-git-handoff
                              {:root root :task-name ${JSON.stringify(TASK)} :commit commit})]
                   {:gate (vec (sort gate))
                    :land (vec (sort land))
                    :unreg-files (vec (sort (map :file (:findings unreg))))
                    :unreg-warning (some? (:warning unreg))}))
               cases))))`
  );
  return JSON.parse(out.split('\n').pop()).map((raw) => ({
    gate: raw.gate,
    land: raw.land,
    unregFiles: raw['unreg-files'],
    unregWarning: raw['unreg-warning'],
  }));
}

// Reach is CONSTRUCTED, not hoped for: every shape is run once outright, and
// the random runs add breadth on top. A purely random draw over six shapes
// really does miss one at these run counts - this file's own first green run
// missed `empty-merge`, which is the shape that separates an honest empty
// answer from the defect's artefact.
function assertReach(seen, shapes) {
  for (const shape of shapes) {
    assert.ok(seen[shape] > 0, `generator never reached ${shape}: ${JSON.stringify(seen)}`);
  }
}

function withRoots(fn) {
  const roots = [];
  const mk = (prefix) => {
    const root = mkTmpDir(prefix);
    roots.push(root);
    return root;
  };
  try {
    return fn(mk);
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }
}

test('property (invariant 1): delivered is the first-parent delta, authored is what differs from every parent', () => {
  withRoots((mk) => {
    const seen = Object.fromEntries(SHAPES.map((s) => [s, 0]));
    const built = [];

    const buildCase = (shape, parcelPaths) => {
      seen[shape] += 1;
      const root = mk('sfvc-bl1297-inv1-');
      initRepo(root);
      const { delivered, authored } = buildShape(root, shape, `${TASK}: the parcel`, parcelPaths);
      const commit = git(root, 'rev-parse', 'HEAD').trim();
      built.push({ shape, parcelPaths, root, commit, delivered, authored });
    };

    for (const shape of SHAPES) buildCase(shape, ['extension/src/parcel0.ts', 'extension/src/parcel7.ts']);

    const seed = newSeed();
    // BL-1585: the extra-breadth draw count expressed through runsPerCell
    // rather than a bare literal, budget unchanged (15).
    const EXTRA_DRAWS = runsPerCell(15 * SHAPES.length, SHAPES.length);
    const draws = fc.sample(fc.tuple(fc.constantFrom(...SHAPES), PARCEL_PATHS()), { numRuns: EXTRA_DRAWS, seed });
    for (const [shape, parcelPaths] of draws) buildCase(shape, parcelPaths);

    console.log(`BL-1564 reach map (invariant 1): ${JSON.stringify({ cases: built.length, seed })}`);

    const results = ownPathsBatch(built.map(({ root, commit }) => ({ root, commit })));

    built.forEach(({ shape, parcelPaths, delivered, authored }, i) => {
      const { delivered: actualDelivered, authored: actualAuthored } = results[i];
      const ctx = `case ${i} (seed=${seed}) shape=${shape} paths=${JSON.stringify(parcelPaths)}`;

      assert.deepEqual(
        actualDelivered,
        [...delivered].sort(),
        `${ctx}: delivered ${JSON.stringify(actualDelivered)}, its first-parent change is ${JSON.stringify(delivered)}`
      );
      // The headline half, stated separately so it cannot be satisfied by a
      // shape that happens to have no paths: a merge that DID change
      // something is never empty.
      if (delivered.length > 0) {
        assert.ok(
          actualDelivered && actualDelivered.length > 0,
          `${ctx}: delivered an empty change set for a commit that changed ${delivered}`
        );
      }

      assert.deepEqual(
        actualAuthored,
        [...authored].sort(),
        `${ctx}: authored ${JSON.stringify(actualAuthored)}, its own resolution is ${JSON.stringify(authored)}`
      );
      // "empty exactly when the merge resolved nothing itself" - stated as an
      // iff, in both directions, because the over-correction this amendment
      // repairs failed the second direction only.
      assert.equal(
        actualAuthored !== null && actualAuthored.length === 0,
        authored.length === 0,
        `${ctx}: authored set is empty for the wrong reason: ${JSON.stringify(actualAuthored)}`
      );
    });

    assertReach(seen, SHAPES);
    assertReachFloor(seen, SHAPES, 1, 'shape');
    // The shapes the defect and its over-correction hide behind carry the whole
    // property; a run that only ever saw single-parent commits would pass
    // against both.
    assert.ok(seen.merge + seen['octopus-merge'] >= 2, `too few clean merge shapes: ${JSON.stringify(seen)}`);
    assert.ok(seen['evil-merge'] >= 1, `the only merge with an author was never drawn: ${JSON.stringify(seen)}`);
  });
}, propertyLaneTimeoutMs(20000));

test('property (invariant 2): an empty answer is the truth, never an artefact of the invocation', () => {
  withRoots((mk) => {
    const seen = { emptyDelivered: 0, emptyAuthored: 0, nonEmptyAuthored: 0 };
    const built = [];

    const buildCase = (shape, parcelPaths) => {
      const root = mk('sfvc-bl1297-inv2-');
      initRepo(root);
      const { delivered, authored } = buildShape(root, shape, `${TASK}: the parcel`, parcelPaths);
      const commit = git(root, 'rev-parse', 'HEAD').trim();

      if (delivered.length === 0) seen.emptyDelivered += 1;
      if (authored.length === 0) seen.emptyAuthored += 1;
      else seen.nonEmptyAuthored += 1;

      built.push({ shape, parcelPaths, root, commit, delivered, authored });
    };

    for (const shape of SHAPES) buildCase(shape, ['extension/src/parcel0.ts', 'extension/src/parcel7.ts']);

    const seed = newSeed();
    // BL-1585: the extra-breadth draw count expressed through runsPerCell
    // rather than a bare literal, budget unchanged (12).
    const EXTRA_DRAWS = runsPerCell(12 * SHAPES.length, SHAPES.length);
    const draws = fc.sample(fc.tuple(fc.constantFrom(...SHAPES), PARCEL_PATHS()), { numRuns: EXTRA_DRAWS, seed });
    for (const [shape, parcelPaths] of draws) buildCase(shape, parcelPaths);

    console.log(`BL-1564 reach map (invariant 2): ${JSON.stringify({ cases: built.length, seed })}`);

    // The unreadable-commit check rides the SAME batch, one more entry, so
    // the invariant still costs exactly one bb process.
    const nilRoot = mk('sfvc-bl1297-inv2-nil-');
    initRepo(nilRoot);
    const absent = '0000000000000000000000000000000000000000';

    const results = ownPathsBatch([...built.map(({ root, commit }) => ({ root, commit })), { root: nilRoot, commit: absent }]);

    built.forEach(({ shape, parcelPaths, delivered, authored }, i) => {
      const { delivered: actualDelivered, authored: actualAuthored } = results[i];
      const ctx = `case ${i} (seed=${seed}) shape=${shape} paths=${JSON.stringify(parcelPaths)}`;
      for (const [actual, expected, semantic] of [
        [actualDelivered, delivered, ':delivered'],
        [actualAuthored, authored, ':authored'],
      ]) {
        // Blindness is never the empty answer. A caller that cannot tell them
        // apart reads an unreadable commit as a clean one - the same fail-open
        // as the merge blind spot, one door down.
        assert.notEqual(actual, null, `${ctx} under ${semantic} reported blindness for a readable commit`);
        assert.equal(
          actual.length === 0,
          expected.length === 0,
          `${ctx} under ${semantic} was empty for the wrong reason: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`
        );
      }
    });

    assert.ok(seen.emptyDelivered > 0, `never produced a genuinely empty delivered set: ${JSON.stringify(seen)}`);
    assert.ok(seen.emptyAuthored > 0, `never produced a genuinely empty authored set: ${JSON.stringify(seen)}`);
    assert.ok(seen.nonEmptyAuthored > 0, `never produced a non-empty authored set: ${JSON.stringify(seen)}`);
    assertReachFloor(seen, ['emptyDelivered', 'emptyAuthored', 'nonEmptyAuthored'], 1, 'answer shape');

    // An unreadable commit answers nil under BOTH semantics, so neither caller
    // can mistake a failed walk for a clean parcel.
    const nil = results[results.length - 1];
    assert.equal(nil.delivered, null, 'an unreadable commit was not nil under :delivered');
    assert.equal(nil.authored, null, 'an unreadable commit was not nil under :authored');
  });
}, propertyLaneTimeoutMs(20000));

// ── invariant 3: each caller reads the question its own decision needs ─────

// The manifest caller 3 reads. Empty (header only) so that any test file the
// parcel introduces is unregistered - which is how caller 3's answer becomes
// observable at all.
function writeManifest(root) {
  const dir = path.join(root, 'swarmforge', 'scripts', 'test');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'suite-manifest.tsv'), 'file\tlane\tdate\treason\n');
}

const TEST_FILE = 'swarmforge/scripts/test/test_bl1297_fixture.sh';
const INV3_SHAPES = ['merge', 'octopus-merge', 'empty-merge', 'evil-merge', 'single-parent'];

test('property (invariant 3): the land step reads delivered, the two send-time gates read authored', () => {
  withRoots((mk) => {
    const seen = { authoredTestFile: 0, deliveredOnlyTestFile: 0, divergent: 0 };
    const built = [];

    const buildCase = (shape, addTestFile) => {
      const root = mk('sfvc-bl1297-inv3-');
      initRepo(root);
      writeManifest(root);
      git(root, 'add', 'swarmforge');
      git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-verify', '-m', `${OTHER}: manifest`);
      // Both callers' bases are pinned to the SAME boundary, so a difference
      // can only come from the semantic each one asks for: the gate reads the
      // handoff archive (absent here, so it walks the cited commit), and the
      // land step reads origin/main.
      const base = git(root, 'rev-parse', 'HEAD').trim();
      git(root, 'update-ref', 'refs/remotes/origin/main', base);

      // The test file goes LAST, so on `evil-merge` it is the path the merge
      // itself resolves - the one merge shape where the gates must see it.
      const parcelPaths = addTestFile ? ['extension/src/parcel1.ts', TEST_FILE] : ['extension/src/parcel1.ts'];
      const { delivered, authored } = buildShape(root, shape, `${TASK}: the parcel`, parcelPaths);
      const commit = git(root, 'rev-parse', 'HEAD').trim();

      if (authored.includes(TEST_FILE)) seen.authoredTestFile += 1;
      if (delivered.includes(TEST_FILE) && !authored.includes(TEST_FILE)) seen.deliveredOnlyTestFile += 1;
      if (delivered.length !== authored.length) seen.divergent += 1;

      built.push({ shape, addTestFile, root, commit, delivered, authored });
    };

    for (const shape of INV3_SHAPES) {
      buildCase(shape, true);
      buildCase(shape, false);
    }

    const seed = newSeed();
    // BL-1585: the extra-breadth draw count expressed through runsPerCell
    // rather than a bare literal, budget unchanged (8).
    const INV3_CELLS = INV3_SHAPES.length * 2;
    const EXTRA_DRAWS = runsPerCell(8 * INV3_CELLS, INV3_CELLS);
    const draws = fc.sample(fc.tuple(fc.constantFrom(...INV3_SHAPES), fc.boolean()), { numRuns: EXTRA_DRAWS, seed });
    for (const [shape, addTestFile] of draws) buildCase(shape, addTestFile);

    console.log(`BL-1564 reach map (invariant 3): ${JSON.stringify({ cases: built.length, seed })}`);

    const results = threeCallersBatch(built.map(({ root, commit }) => ({ root, commit })));

    built.forEach(({ shape, addTestFile, delivered, authored }, i) => {
      const { gate, land, unregFiles, unregWarning } = results[i];
      const ctx = `case ${i} (seed=${seed}) shape=${shape} addTestFile=${addTestFile}`;
      assert.ok(!unregWarning, `${ctx}: caller 3 could not read the parcel`);

      // Caller 1 - the land-step replay. BL-1315: every non-TASK path in
      // this fixture family is tagged OTHER, a real (unlanded) ticket id,
      // so the land step now excludes it - the same exclusion BL-1315
      // applies to a genuine unlanded sibling's own content. What remains
      // is exactly what the TASK-tagged commit itself authored: nothing
      // else in this fixture ever carries TASK's own id, so `delivered`
      // (BL-1297's pre-BL-1315 oracle, "whatever the tagged commit's
      // first-parent diff happened to include") is no longer what the land
      // step reads - `authored` is.
      assert.deepEqual(land, [...authored].sort(), `${ctx}: the land step misreads authored=${JSON.stringify(authored)}`);

      // Caller 2 - the send-time scope gate - judges the parcel's AUTHOR. A
      // clean receive-merge authored nothing, and charging it with the
      // tickets that rode in on it refuses every forward in the pipeline.
      assert.deepEqual(gate, [...authored].sort(), `${ctx}: the scope gate misreads authored=${JSON.stringify(authored)}`);

      // Caller 3 asks caller 2's question through the seam they share, and
      // must never answer it differently. Read the gate's OWN findings
      // (which name a file by basename), not the whole raw map: under the
      // amended contract `land` names delivered paths the gates must not
      // see, so a substring check over the raw map would find the test file
      // there and pass for the wrong reason.
      assert.equal(
        (unregFiles || []).includes(path.basename(TEST_FILE)),
        authored.includes(TEST_FILE),
        `${ctx}: the unregistered-test gate disagrees with the scope gate, delivered=${JSON.stringify(delivered)} authored=${JSON.stringify(authored)}`
      );
    });

    // The two cases that separate the semantics are constructed, not hoped for.
    // Without the second, every row could pass with both callers reading the
    // same answer - which is exactly the contract this amendment replaced.
    assert.ok(seen.authoredTestFile > 0, `the gates were never given an authored test file: ${JSON.stringify(seen)}`);
    assert.ok(
      seen.deliveredOnlyTestFile > 0,
      `no case delivered a test file the merger did not author: ${JSON.stringify(seen)}`
    );
    assert.ok(seen.divergent > 0, `the two answers never diverged, so nothing was distinguished: ${JSON.stringify(seen)}`);
    assertReachFloor(seen, ['authoredTestFile', 'deliveredOnlyTestFile', 'divergent'], 1, 'divergence case');
  });
}, propertyLaneTimeoutMs(20000));
