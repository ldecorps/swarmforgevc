'use strict';

// BL-1389's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A path whose every attributing commit names one unlanded
//                sibling and never the landing ticket is excluded from the
//                replay, WHATEVER that sibling's human_approval reads.
//                BL-1375's passenger rule applies only to a path the landing
//                ticket ALSO owns.
//   invariant 2  A sibling reads landed only when EVERY path attributed to it
//                has that sibling's own lines on origin/main; one landed path
//                never makes an unlanded sibling read landed.
//   invariant 3  The report names, per excluded path, the path and the sibling
//                it was credited to, and per landed sibling the path that
//                decided the verdict.
//
// Drives the REAL swarmforge/scripts/land_step_lib.bb `land-plan` - the whole
// decision, both walks together - against real git fixtures. Never a
// JavaScript restatement of it: the defect is one walk's verdict deciding
// another walk's paths, and a driver that calls a single function cannot see
// the two disagree.
//
// GENERATOR REACH (by CONSTRUCTION, never by draw). The defect needs the two
// walks to attribute DIFFERENT sets, and that is not a state a random repo
// wanders into. It is built: the sibling's exclusive work reaches the tip on a
// MERGED SIDE BRANCH, while its feature file is committed on the first-parent
// line and already on origin/main. `task-tagged-changed-paths` walks
// `rev-list --first-parent`, so it sees only the feature file and reads the
// sibling LANDED; `path-owner-tickets` walks `git log -- <path>`, which sees
// every parent, so it credits the merged handler and source to that same
// sibling. Pre-BL-1389 the exclusion asked the first walk about the second
// walk's paths, and the sibling's unlanded files rode into the replay - the
// 2026-09-04 BL-1367-in-BL-1386 incident exactly. Every pass asserts the
// shapes it needed were actually built.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const FIXTURE_PREFIX = 'bl1389-property-';
const LANDING = 'BL-9389';
const SIBLING = 'BL-9390';
const FEATURE_PATH = `specs/features/${SIBLING}-sibling.feature`;
const OWN_PATH = `backlog/active/${LANDING}-own.yaml`;

// The sibling's approval state. Invariant 1 says none of these changes the
// answer for a path the sibling owns ALONE - `absent` and `approved` are the
// states that would let it ride if the exclusion consulted approval, and
// `withheld` is the state BL-1375 refuses on for a SHARED path, included so a
// pass cannot be mistaken for BL-1375 doing the work.
const APPROVAL_SHAPES = [
  { name: 'approved', folder: 'active', field: 'human_approval: approved\n' },
  { name: 'absent', folder: 'active', field: '' },
  { name: 'withheld', folder: 'hold', field: 'human_approval: approved\n' },
];

const exclusivePath = (i) => `specs/pipeline/steps/${SIBLING}Part${i}Steps.js`;

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
}

const head = (root) => git(root, 'rev-parse', 'HEAD').trim();

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

// Advances origin/main itself to carry `entries`, via plumbing: the content is
// ON MAIN as a different commit object, which is the shape of a sibling that
// landed through its own tip-pure replay - not merely committed on the tip.
function putOnMain(root, entries) {
  const base = git(root, 'rev-parse', 'refs/remotes/origin/main').trim();
  const index = path.join(root, '.git', 'bl1389-property-index');
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const plumb = (args, input) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', input }).trim();
  plumb(['read-tree', base]);
  for (const [rel, body] of entries) {
    const blob = plumb(['hash-object', '-w', '--stdin'], body);
    plumb(['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`]);
  }
  const tree = plumb(['write-tree']);
  const commit = plumb(['commit-tree', tree, '-p', base, '-m', 'origin/main already carries this content']);
  git(root, 'update-ref', 'refs/remotes/origin/main', commit);
  fs.rmSync(index, { force: true });
}

/**
 * The two-walk divergence, built.
 *
 * `exclusiveCount` paths belong to the sibling ALONE and arrive on a merged
 * side branch. `siblingLanded` decides whether their content is also on
 * origin/main - false is the fail-open shape this ticket exists for, true is
 * invariant 2's positive side, where the sibling really has landed everything.
 */
function buildFixture({ exclusiveCount, approval, siblingLanded }) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'merge.ff', 'false');
  commitFile(root, 'seed.md', 'seed\n', 'seed the repository');
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));
  const base = head(root);

  // First-parent line: the sibling's feature file, minted at spec time. This
  // is the ONLY path the per-sibling walk will see, and it is on origin/main -
  // so that walk alone reads the sibling as fully landed.
  const featureBody = `Feature: ${SIBLING} sibling\n`;
  commitFile(root, FEATURE_PATH, featureBody, `${SIBLING}: mint the feature file`);

  // Side branch: the sibling's real pipeline work, merged in. `git log -- path`
  // sees these commits; `rev-list --first-parent` does not.
  git(root, 'checkout', '-q', '-b', 'sibling-work', base);
  const exclusive = [];
  for (let i = 0; i < exclusiveCount; i += 1) {
    const rel = exclusivePath(i);
    exclusive.push([rel, `// ${SIBLING} part ${i}\n`]);
    commitFile(root, rel, `// ${SIBLING} part ${i}\n`, `${SIBLING}: the sibling's own file ${i}`);
  }
  git(root, 'checkout', '-q', 'main');
  // The merge names neither ticket: a merge subject naming one would attribute
  // through the first-parent walk and dissolve the very divergence under test.
  git(root, 'merge', '-q', '--no-ff', '-m', "Merge the sibling's branch", 'sibling-work');

  // The ticket file is the sibling's too. It goes on origin/main in BOTH
  // shapes, and that is load-bearing: every path the FIRST-PARENT walk
  // attributes to the sibling must be landed, or that walk reads the sibling
  // unlanded on its own and the pre-BL-1389 predicate excludes the merged
  // paths for a reason that has nothing to do with this ticket - a property
  // that passes against the defect (checked: it does, without this).
  const ticketRel = `backlog/${approval.folder}/${SIBLING}-sibling.yaml`;
  const ticketBody = `id: ${SIBLING}\nstatus: todo\n${approval.field}`;
  commitFile(root, ticketRel, ticketBody, `${SIBLING}: the sibling's ticket file`);
  commitFile(root, OWN_PATH, `id: ${LANDING}\nstatus: todo\n`, `${LANDING}: the landing ticket's own file`);
  const commit = head(root);

  // origin/main carries the feature file always; the exclusive work only when
  // the sibling really did land.
  const alwaysOnMain = [[FEATURE_PATH, featureBody], [ticketRel, ticketBody]];
  putOnMain(root, siblingLanded ? [...alwaysOnMain, ...exclusive] : alwaysOnMain);
  return { root, commit, ticketRel, exclusive: exclusive.map(([rel]) => rel) };
}

function landPlan(root, commit) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(let [r (land-step-lib/land-plan {:root "${root}" :commit "${commit}" :task-ticket-id "${LANDING}"})]
  (println (json/generate-string
            {:action (name (:action r))
             :reason (:reason r)
             :ownPaths (vec (sort (or (:own-paths r) [])))
             :landed (vec (sort (or (:landed r) [])))
             :unlanded (vec (sort (or (:unlanded r) [])))
             :landedPaths (or (:landed-paths r) {})
             :excluded (vec (for [e (or (:excluded r) [])]
                              [(:path e) (vec (sort (:owners e)))]))})))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// A killed run traps no `finally`, so the previous run's fixtures are swept by
// prefix BEFORE this one starts as well (BL-971). Safe here for the reason it
// is not safe in a production guard (BL-1385): these roots are this test's own.
function sweepFixtures() {
  const parent = os.tmpdir();
  for (const entry of fs.readdirSync(parent)) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(parent, entry), { recursive: true, force: true });
    }
  }
}

test("BL-1389/BL-654 invariant 1: a path an unlanded sibling owns alone never rides, whatever its approval reads", () => {
  sweepFixtures();
  const reach = Object.fromEntries(APPROVAL_SHAPES.map((s) => [s.name, 0]));

  for (const approval of APPROVAL_SHAPES) {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }), (exclusiveCount) => {
        const { root, commit, exclusive } = buildFixture({ exclusiveCount, approval, siblingLanded: false });
        try {
          reach[approval.name] += 1;
          const plan = landPlan(root, commit);
          assert.equal(plan.action, 'replay', `the land did not plan a replay: ${JSON.stringify(plan)}`);

          const excludedPaths = new Set(plan.excluded.map(([p]) => p));
          for (const rel of exclusive) {
            // What lands is the replayed set, so absence from it is the claim
            // that matters - the report line is invariant 3's, below.
            assert.ok(
              !plan.ownPaths.includes(rel),
              `${rel} rode into ${approval.name}'s replay: ${JSON.stringify(plan)}`,
            );
            assert.ok(
              excludedPaths.has(rel),
              `${rel} was dropped without being reported: ${JSON.stringify(plan)}`,
            );
          }
          // The landing ticket's own contribution is untouched: the exclusion
          // is a narrowing, never a refusal of the land.
          assert.ok(plan.ownPaths.includes(OWN_PATH), `the landing ticket's own path was dropped: ${JSON.stringify(plan)}`);
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 3 },
    );
  }

  for (const s of APPROVAL_SHAPES) assert.ok(reach[s.name] > 0, `never exercised the ${s.name} approval shape`);
});

test('BL-1389/BL-654 invariant 2: a sibling reads landed only when EVERY attributed path is on origin/main', () => {
  sweepFixtures();
  const reach = { 'some-landed': 0, 'all-landed': 0 };

  for (const siblingLanded of [false, true]) {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }), (exclusiveCount) => {
        // Approval is irrelevant to the verdict; one shape is enough here, and
        // invariant 1's pass above sweeps the rest.
        const { root, commit, ticketRel, exclusive } = buildFixture({
          exclusiveCount,
          approval: APPROVAL_SHAPES[0],
          siblingLanded,
        });
        try {
          reach[siblingLanded ? 'all-landed' : 'some-landed'] += 1;
          const plan = landPlan(root, commit);

          if (siblingLanded) {
            assert.ok(
              plan.landed.includes(SIBLING),
              `every attributed path is on origin/main but the sibling read unlanded: ${JSON.stringify(plan)}`,
            );
            // Invariant 3's landed half: the verdict names the path it rests
            // on, so a human checks it without diffing the tip.
            const deciding = plan.landedPaths[SIBLING];
            assert.ok(deciding, `a landed verdict named no deciding path: ${JSON.stringify(plan)}`);
            assert.ok(
              [FEATURE_PATH, ticketRel, ...exclusive].includes(deciding),
              `the deciding path is not one the sibling owns: ${deciding}`,
            );
          } else {
            // The feature file IS on origin/main. One landed path never makes
            // an unlanded sibling read landed - the fail-open this ticket is.
            assert.ok(
              plan.unlanded.includes(SIBLING),
              `a sibling with ${exclusiveCount} path(s) absent from origin/main read landed: ${JSON.stringify(plan)}`,
            );
            assert.ok(!plan.landed.includes(SIBLING), `the sibling read both landed and unlanded: ${JSON.stringify(plan)}`);
          }
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 3 },
    );
  }

  for (const shape of Object.keys(reach)) assert.ok(reach[shape] > 0, `never exercised the ${shape} shape`);
});

test('BL-1389/BL-654 invariant 3: the report is enough to check the verdict without diffing the tip', () => {
  sweepFixtures();
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 3 }), fc.boolean(), (exclusiveCount, siblingLanded) => {
      const { root, commit, exclusive } = buildFixture({
        exclusiveCount,
        approval: APPROVAL_SHAPES[1],
        siblingLanded,
      });
      try {
        const plan = landPlan(root, commit);
        // Completeness first: a report that names nothing is checkable only by
        // diffing the tip, which is the whole complaint. Every path the replay
        // dropped is named, with its sibling.
        const excludedPaths = new Set(plan.excluded.map(([p]) => p));
        for (const rel of exclusive) {
          if (siblingLanded) {
            assert.ok(!excludedPaths.has(rel), `${rel} was excluded though the sibling landed it`);
          } else {
            assert.ok(excludedPaths.has(rel), `${rel} left the replay unnamed: ${JSON.stringify(plan)}`);
            assert.deepEqual(
              plan.excluded.find(([p]) => p === rel)[1],
              [SIBLING],
              `${rel} was named without the sibling it was credited to`,
            );
          }
        }
        // Every excluded entry names its path AND the sibling it was credited
        // to - the report printed 17 landed names and not one path, which is
        // why the false verdict was invisible until QA diffed the replay.
        for (const [p, owners] of plan.excluded) {
          assert.ok(p, `an exclusion named no path: ${JSON.stringify(plan.excluded)}`);
          assert.ok(owners.length > 0, `${p} was excluded and credited to nobody`);
          assert.ok(!plan.ownPaths.includes(p), `${p} was reported excluded and replayed anyway`);
        }
        // Every landed verdict, and only a landed verdict, carries a path.
        assert.deepEqual(
          Object.keys(plan.landedPaths).sort(),
          [...plan.landed].sort(),
          `the landed names and the deciding paths disagree: ${JSON.stringify(plan)}`,
        );
        for (const id of plan.landed) {
          assert.ok(plan.landedPaths[id], `${id} read landed with no deciding path`);
        }
        return true;
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 4 },
  );
});
