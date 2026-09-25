'use strict';

// BL-1717's declared invariant (property authorship rests with the coder,
// first pass - BL-654):
//
//   "A delivered path whose lines not yet on origin/main are attributable
//    only to unlanded siblings never rides a land, whichever landed
//    tickets also touched it; an unlanded sibling's lines ride only on a
//    path the landing ticket changed, named as a passenger."
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Drives the REAL swarmforge/scripts/land_step_lib.bb `own-paths` - the
// exact function QA's D1 bounce (backlog/evidence/BL-1717-QA-20260925.md)
// probed by hand - with a real git fixture and `:path-landed-fn` injected
// (QA's own remediation pointer for D2: "via own-paths with :path-landed-fn
// injected", not a JS restatement of the decision). The defect the pre-fix
// disjunct shipped: once a path had ANY landed co-owner, the remaining
// not-yet-landed owner(s) were tested against the TICKET-LEVEL
// unlanded-siblings set instead of "is anything left at all" - so an
// unlanded co-owner absent from that set (BL-1687's exact BL-9002/BL-1693
// shape) rode unreported the instant a landed co-owner was also present.
//
// GENERATOR REACH (by CONSTRUCTION, never by draw). Four named cells cross
// the dimensions QA's remediation named: path-landed/not per owner, in/out
// of the ticket-level unlanded-siblings set, and whether the landing ticket
// itself also owns the path. `landedCount` varies within each cell for
// owner-count reach; the cell identity - not the draw - is what proves each
// shape was exercised.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir, sweepStaleTmpDirs } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { propertyLaneTimeoutMs } = require('./helpers/propertyLaneContentionBudget');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const FIXTURE_PREFIX = 'bl1717-property-';

const LANDING = 'BL-9717';
const UNLANDED = 'BL-9799';
const P = 'shared.md';
const Q = `backlog/active/${LANDING}-own.yaml`;

const landedId = (i) => `BL-97${20 + i}`;

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

/**
 * Builds a linear fixture: `landedCount` co-owners touch P first (each its
 * own tagged commit), then U's commit (if `hasUnlanded`) appends its own
 * line to P, then A's commit (if `aOwnsP`) appends its own line to P, then
 * A's own file Q is always committed. origin/main is the seed commit before
 * any of this - so the whole thing is "delivered" and reaches own-paths'
 * exclusion logic, exactly like QA's own D1 probe.
 */
function buildFixture({ landedCount, hasUnlanded, aOwnsP }) {
  const root = mkTmpDir(`${FIXTURE_PREFIX}${process.pid}-`);
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  commitFile(root, 'seed.md', 'seed\n', 'seed the repository');
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));

  const landedIds = [];
  let content = '';
  for (let i = 0; i < landedCount; i += 1) {
    const id = landedId(i);
    landedIds.push(id);
    content += `${id} line\n`;
    commitFile(root, P, content, `${id}: touch the shared path`);
  }
  if (hasUnlanded) {
    content += `${UNLANDED} line\n`;
    commitFile(root, P, content, `${UNLANDED}: touch the shared path`);
  }
  if (aOwnsP) {
    content += `${LANDING} line\n`;
    commitFile(root, P, content, `${LANDING}: also touch the shared path`);
  }
  commitFile(root, Q, `id: ${LANDING}\nstatus: todo\n`, `${LANDING}: the landing ticket's own file`);

  return { root, commit: head(root), landedIds };
}

function ownPaths(root, commit, landedIds, unlandedSiblings) {
  const landedSet = landedIds.length ? `#{${landedIds.map((id) => `"${id}"`).join(' ')}}` : '#{}';
  const unlandedSet = unlandedSiblings.length ? `#{${unlandedSiblings.map((id) => `"${id}"`).join(' ')}}` : '#{}';
  const program = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(let [landed ${landedSet}
      unlanded-siblings ${unlandedSet}
      r (land-step-lib/own-paths "${root}" "${commit}" "${LANDING}" unlanded-siblings nil nil
          {:path-landed-fn (fn [sib _path] (contains? landed sib))})]
  (println (json/generate-string
            {:paths (or (:paths r) [])
             :warning (:warning r)
             :excluded (vec (for [e (or (:excluded r) [])]
                              [(:path e) (vec (sort (:owners e)))]))})))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function sweepFixtures() {
  sweepStaleTmpDirs({ prefix: FIXTURE_PREFIX });
}

// { name, landedCount range, hasUnlanded, uInSet, aOwnsP, expect }
const CELLS = [
  {
    name: 'excluded-not-in-set',
    landedCount: () => fc.integer({ min: 0, max: 2 }),
    hasUnlanded: true,
    uInSet: false,
    aOwnsP: false,
    expectExcluded: true,
  },
  {
    name: 'excluded-in-set',
    landedCount: () => fc.integer({ min: 0, max: 2 }),
    hasUnlanded: true,
    uInSet: true,
    aOwnsP: false,
    expectExcluded: true,
  },
  {
    name: 'kept-all-landed',
    landedCount: () => fc.integer({ min: 1, max: 3 }),
    hasUnlanded: false,
    uInSet: false,
    aOwnsP: false,
    expectExcluded: false,
  },
  {
    name: 'kept-a-owns',
    landedCount: () => fc.integer({ min: 0, max: 2 }),
    hasUnlanded: true,
    uInSet: false,
    aOwnsP: true,
    expectExcluded: false,
  },
];

test('BL-1717/BL-654 invariant: a landed co-owner never shields a not-yet-landed co-owner, whichever landed tickets also touched the path', () => {
  sweepFixtures();
  const reach = Object.fromEntries(CELLS.map((c) => [c.name, 0]));
  const CELL_RUNS = runsPerCell(4 * CELLS.length, CELLS.length);

  for (const cell of CELLS) {
    fc.assert(
      fc.property(cell.landedCount(), (landedCount) => {
        const { root, commit, landedIds } = buildFixture({
          landedCount,
          hasUnlanded: cell.hasUnlanded,
          aOwnsP: cell.aOwnsP,
        });
        try {
          reach[cell.name] += 1;
          const unlandedSiblings = cell.uInSet ? [UNLANDED] : [];
          const plan = ownPaths(root, commit, landedIds, unlandedSiblings);
          assert.equal(plan.warning, null, `own-paths warned: ${JSON.stringify(plan)}`);
          // The landing ticket's own contribution never depends on this
          // decision - it always rides.
          assert.ok(plan.paths.includes(Q), `${Q} was dropped: ${JSON.stringify(plan)}`);

          const excludedPaths = new Set(plan.excluded.map(([p]) => p));
          if (cell.expectExcluded) {
            assert.ok(!plan.paths.includes(P), `${P} rode into the replay in cell ${cell.name}: ${JSON.stringify(plan)}`);
            assert.ok(excludedPaths.has(P), `${P} was dropped without being reported in cell ${cell.name}: ${JSON.stringify(plan)}`);
            const owners = plan.excluded.find(([p]) => p === P)[1];
            assert.ok(owners.includes(UNLANDED), `${P} was excluded but not credited to ${UNLANDED}: ${JSON.stringify(plan)}`);
          } else {
            assert.ok(plan.paths.includes(P), `${P} was excluded in cell ${cell.name} though it should ride: ${JSON.stringify(plan)}`);
            assert.ok(!excludedPaths.has(P), `${P} rode and was ALSO reported excluded in cell ${cell.name}: ${JSON.stringify(plan)}`);
          }
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: CELL_RUNS },
    );
  }

  assertReachFloor(reach, CELLS.map((c) => c.name), CELL_RUNS, 'BL-1717 own-paths cell');
}, propertyLaneTimeoutMs(20000));
