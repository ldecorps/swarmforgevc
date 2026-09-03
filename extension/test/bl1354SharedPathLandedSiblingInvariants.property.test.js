'use strict';

// BL-1354's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  Landed stays a POSITIVE finding, never an inference from
//                silence: a walk that failed, an empty attributed path set
//                and an unreadable diff each still report the sibling as
//                unlanded (BL-1272 invariant 1, carried forward unchanged).
//   invariant 2  A sibling is judged on its OWN attributed content only -
//                another ticket's lines in a shared file never make a landed
//                sibling read unlanded, and never make an unlanded sibling
//                read landed.
//
// Drives the REAL swarmforge/scripts/land_step_lib.bb against real git
// fixtures - never a JavaScript restatement of the decision. The landed
// siblings' content reaches origin/main as a tip-pure REPLAY (a different
// commit object), which is what leaves the shared file's blob differing while
// their own lines are all present: the exact state whole-blob equality got
// wrong.
//
// GENERATOR REACH (by construction, never by draw). The defect needs a file
// whose lines belong to MORE THAN ONE sibling with a MIXED landed state, so
// the co-ownership is built rather than hoped for: every sibling's line goes
// into the same shared file in every case, and the landed/unlanded split is
// drawn over that shape. The three mixes - none landed, some landed, all
// landed - each get their own pass, and the run asserts each was exercised.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const FIXTURE_PREFIX = 'bl1354-property-';
const LANDING = 'BL-9301';
const SHARED = 'docs/shared-reference.md';
const MIXES = ['none-landed', 'some-landed', 'all-landed'];

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function head(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function writeCommit(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

const siblingId = (i) => `BL-94${String(i).padStart(2, '0')}`;
const siblingLine = (id) => `${id} owns this line`;
const privatePath = (id) => `notes/${id}.md`;

/**
 * A repo whose ONE shared file carries a line from every sibling, and whose
 * origin/main already carries `landedIds`' own lines as a tip-pure replay.
 */
function buildFixture(siblingCount, landedIds) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  writeCommit(root, SHARED, 'base line\n', 'seed the shared reference');
  const base = head(root);
  git(root, 'update-ref', 'refs/remotes/origin/main', base);

  const ids = Array.from({ length: siblingCount }, (_, i) => siblingId(i));
  let shared = 'base line\n';
  for (const id of ids) {
    shared += `${siblingLine(id)}\n`;
    writeCommit(root, SHARED, shared, `${id}: a line in the shared reference`);
    writeCommit(root, privatePath(id), `${id} private body\n`, `${id}: its own private file`);
  }
  writeCommit(root, 'landing/own.md', 'the landing ticket\n', `${LANDING}: the landing ticket's own work`);
  const commit = head(root);

  if (landedIds.length > 0) {
    git(root, 'checkout', '-q', '-b', 'landing', base);
    let landedShared = 'base line\n';
    for (const id of landedIds) landedShared += `${siblingLine(id)}\n`;
    writeCommit(root, SHARED, landedShared, `${landedIds[0]}: shared reference (replayed tip-pure)`);
    for (const id of landedIds) {
      writeCommit(root, privatePath(id), `${id} private body\n`, `${id}: its own private file (replayed tip-pure)`);
    }
    git(root, 'update-ref', 'refs/remotes/origin/main', head(root));
    git(root, 'checkout', '-q', 'main');
  }
  return { root, commit, ids };
}

function classify(root, commit) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(let [r (land-step-lib/entangled-siblings "${root}" "${commit}" "${LANDING}")]
  (println (json/generate-string
            {:landed (vec (sort (or (:landed r) [])))
             :unlanded (vec (sort (or (:unlanded r) [])))
             :warning (:warning r)})))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function landedSubset(mix, ids) {
  if (mix === 'none-landed') return [];
  if (mix === 'all-landed') return [...ids];
  return ids.slice(0, Math.max(1, ids.length - 1));
}

// A killed run traps no `finally`, so the previous run's fixtures are swept by
// prefix BEFORE this one starts as well (BL-971).
function sweepFixtures() {
  const parent = os.tmpdir();
  for (const entry of fs.readdirSync(parent)) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(parent, entry), { recursive: true, force: true });
    }
  }
}

test('BL-1354/BL-654 invariant 2: a sibling is judged on its own attributed content only', () => {
  sweepFixtures();
  const reach = Object.fromEntries(MIXES.map((m) => [m, 0]));

  for (const mix of MIXES) {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 4 }), (siblingCount) => {
        const ids = Array.from({ length: siblingCount }, (_, i) => siblingId(i));
        const landed = landedSubset(mix, ids);
        const { root, commit } = buildFixture(siblingCount, landed);
        try {
          reach[mix] += 1;
          const report = classify(root, commit);
          assert.equal(report.warning, null, `the classification could not run: ${report.warning}`);

          // Every sibling whose OWN lines are on origin/main reads landed,
          // however many co-owners of the same file are still unlanded...
          for (const id of landed) {
            assert.ok(
              report.landed.includes(id),
              `${id}'s own lines are all landed but it read unlanded (${mix}, ${siblingCount} siblings): ${JSON.stringify(report)}`,
            );
          }
          // ...and every sibling whose own lines are NOT there reads unlanded,
          // however many co-owners of the same file have landed.
          for (const id of ids.filter((i) => !landed.includes(i))) {
            assert.ok(
              report.unlanded.includes(id),
              `${id}'s own lines are absent but it read landed (${mix}, ${siblingCount} siblings): ${JSON.stringify(report)}`,
            );
          }
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 3 },
    );
  }

  for (const mix of MIXES) assert.ok(reach[mix] > 0, `never exercised the ${mix} mix`);
});

test('BL-1354/BL-654 invariant 1: an unanswerable attribution never reads landed', () => {
  sweepFixtures();
  const SHAPES = ['walk-failed', 'empty-path-set', 'unreadable-diff'];
  const reach = Object.fromEntries(SHAPES.map((s) => [s, 0]));

  for (const shape of SHAPES) {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 4 }), (siblingCount) => {
        const ids = Array.from({ length: siblingCount }, (_, i) => siblingId(i));
        // Everything is landed, so ONLY the unanswerable attribution can hold
        // the verdict back - a shape that reported unlanded for some other
        // reason would prove nothing about invariant 1.
        const { root, commit } = buildFixture(siblingCount, ids);
        try {
          reach[shape] += 1;
          let report;
          if (shape === 'unreadable-diff') {
            const target = execFileSync(
              'git',
              ['log', '--format=%H', '-1', `--grep=^${ids[0]}:`, commit],
              { cwd: root, encoding: 'utf8' },
            ).trim();
            const tree = execFileSync('git', ['rev-parse', `${target}^{tree}`], {
              cwd: root,
              encoding: 'utf8',
            }).trim();
            fs.rmSync(path.join(root, '.git', 'objects', tree.slice(0, 2), tree.slice(2)), { force: true });
            report = classify(root, commit);
          } else {
            const pathsFn = shape === 'walk-failed' ? '(constantly nil)' : '(constantly [])';
            const program = `
(require '[cheshire.core :as json] '[clojure.string :as str] '[babashka.process :as p])
(load-file "${LAND_STEP_LIB}")
(let [root "${root}" commit "${commit}"
      om (land-step-lib/origin-main-sha root)
      cands (str/split-lines (str/trim (:out (p/sh {:dir root} "git" "rev-list" (str om ".." commit)))))
      sibs #{${ids.map((i) => `"${i}"`).join(' ')}}
      landed (land-step-lib/landed-siblings root commit om cands sibs ${pathsFn})]
  (println (json/generate-string {:landed (vec (sort landed))
                                  :unlanded (vec (sort (remove landed sibs)))
                                  :warning nil})))`;
            const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
            assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
            report = JSON.parse(r.stdout.trim().split('\n').pop());
          }

          if (shape === 'unreadable-diff') {
            assert.ok(
              !report.landed.includes(ids[0]),
              `an unreadable diff read as landed: ${JSON.stringify(report)}`,
            );
          } else {
            assert.deepEqual(report.landed, [], `${shape} read as landed: ${JSON.stringify(report)}`);
          }
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 3 },
    );
  }

  for (const shape of SHAPES) assert.ok(reach[shape] > 0, `never exercised the ${shape} shape`);
});
