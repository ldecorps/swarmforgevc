'use strict';

// BL-1857's declared invariant (property authorship rests with the coder,
// first pass - BL-654):
//
//   "An untagged commit is left out of a shared path's attribution only
//    when no line it added to that path is in the landing commit's copy
//    and absent from origin/main's copy; every other untagged touch still
//    refuses by name."
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Drives the REAL swarmforge/scripts/land_step_lib.bb `own-paths` - same
// public entry point BL-1830's own property test
// (bl1830SharedOwnPathLineExclusionInvariants.property.test.js) drives, and
// the new private predicate `untagged-commit-lands-no-line?` feeds into -
// over a real git fixture, with `unlanded-siblings` given explicitly, never
// a JS restatement of the line-exclusion decision.
//
// GENERATOR REACH (by CONSTRUCTION, never by draw). Three cells, matching
// the ticket's own outline rows exactly:
//   'restore-excluded' (row 1): the landing ticket adds its own lines, an
//   UNTAGGED commit then restores the path to origin/main's exact content
//   (removing nothing but the landing ticket's own just-added lines - it
//   adds no line of its own at all, so the predicate holds vacuously), the
//   landing ticket reapplies its own lines, then the sibling adds its own.
//   No refusal; the sibling's lines are excluded by the ordinary tag-based
//   rebuild, unaffected by the untagged restore.
//   'add-remove-excluded' (row 2): after the landing ticket's own append,
//   an UNTAGGED commit adds a transient line and a LATER untagged commit
//   removes that exact line again before the sibling's own commit - net
//   contribution to the landing commit's own copy is nothing, so the
//   predicate holds and it is excluded the same way.
//   'add-keep-refuses' (row 3, unchanged from BL-1830): an UNTAGGED commit
//   adds a line that survives into the landing commit's own copy and
//   origin/main never had - the predicate is false (the added line is in
//   the landing copy and absent from origin's), so it still keeps
//   `:any-untagged? true` and the land refuses by name, exactly as
//   BL-1830's own 'untagged-touch-escalates' cell already covers. Included
//   here too (same construction) because it is this ticket's own outline
//   row and its own invariant's "every other untagged touch still refuses
//   by name" clause.

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
const FIXTURE_PREFIX = 'bl1857-property-';

const LANDING = 'BL-9718';
const UNLANDED = 'BL-9800';
const P = 'shared.md';
const Q = `backlog/active/${LANDING}-own.yaml`;

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

function initRepo() {
  const root = mkTmpDir(`${FIXTURE_PREFIX}${process.pid}-`);
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  // The sibling's own ticket file, seeded BEFORE origin/main is marked -
  // never part of the parcel's own delivered diff. APPROVED, so the
  // sibling is non-blocking (BL-1332/BL-1375's older clause).
  commitFile(
    root,
    `backlog/active/${UNLANDED}-sibling.yaml`,
    `id: ${UNLANDED}\nstatus: todo\nhuman_approval: approved\n`,
    `${UNLANDED}: the sibling's ticket`
  );
  return root;
}

/**
 * restore-excluded: baseline on origin/main. The landing ticket adds its
 * own lines (tagged LANDING). An UNTAGGED commit restores P to EXACTLY
 * origin/main's content (undoing the landing ticket's just-added lines,
 * adding no line of its own). The landing ticket then reapplies the same
 * lines (tagged LANDING again). The sibling adds its own lines last
 * (tagged UNLANDED).
 */
function buildRestoreFixture({ baselineCount, ownCount, siblingCount }) {
  const root = initRepo();
  const baseline = Array.from({ length: baselineCount }, (_, i) => `base-${String(i).padStart(2, '0')}`);
  commitFile(root, P, `${baseline.join('\n')}\n`, 'seed P on origin/main');
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));

  commitFile(root, Q, `id: ${LANDING}\nstatus: todo\n`, `${LANDING}: the landing ticket's own file`);

  const own = Array.from({ length: ownCount }, (_, i) => `own-${String(i).padStart(2, '0')}`);
  commitFile(root, P, `${baseline.concat(own).join('\n')}\n`, `${LANDING}: add its own lines to the shared path`);

  commitFile(root, P, `${baseline.join('\n')}\n`, 'Restore bounced parcel paths to origin/main content.');

  commitFile(root, P, `${baseline.concat(own).join('\n')}\n`, `${LANDING}: reapply its own lines after restore`);

  const sibling = Array.from({ length: siblingCount }, (_, i) => `sib-${String(i).padStart(2, '0')}`);
  commitFile(root, P, `${baseline.concat(own).concat(sibling).join('\n')}\n`, `${UNLANDED}: add its own lines to the shared path`);

  return { root, commit: head(root), baseline, own, sibling };
}

/**
 * add-remove-excluded: after the landing ticket's own append, an UNTAGGED
 * commit adds a transient line; a LATER untagged commit removes that exact
 * line again before the sibling's own commit - net contribution to the
 * landing commit's own copy is nothing.
 */
function buildAddRemoveFixture({ baselineCount, ownCount, siblingCount }) {
  const root = initRepo();
  const baseline = Array.from({ length: baselineCount }, (_, i) => `base-${String(i).padStart(2, '0')}`);
  commitFile(root, P, `${baseline.join('\n')}\n`, 'seed P on origin/main');
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));

  commitFile(root, Q, `id: ${LANDING}\nstatus: todo\n`, `${LANDING}: the landing ticket's own file`);

  const own = Array.from({ length: ownCount }, (_, i) => `own-${String(i).padStart(2, '0')}`);
  const afterOwn = baseline.concat(own);
  commitFile(root, P, `${afterOwn.join('\n')}\n`, `${LANDING}: add its own lines to the shared path`);

  const transient = 'transient-scratch-row';
  commitFile(root, P, `${afterOwn.concat([transient]).join('\n')}\n`, 'Re-point scratch pass: add a transient row');
  commitFile(root, P, `${afterOwn.join('\n')}\n`, 'Re-point scratch pass: drop the transient row');

  const sibling = Array.from({ length: siblingCount }, (_, i) => `sib-${String(i).padStart(2, '0')}`);
  commitFile(root, P, `${afterOwn.concat(sibling).join('\n')}\n`, `${UNLANDED}: add its own lines to the shared path`);

  return { root, commit: head(root), baseline, own, sibling };
}

/**
 * add-keep-refuses (row 3, unchanged from BL-1830): an UNTAGGED commit adds
 * a line that survives into the landing commit's own copy and origin/main
 * never had - derived from the sibling's own baseline so every generated
 * case is a genuine, non-empty content change.
 */
function buildAddKeepFixture({ baselineCount, ownCount, siblingCount }) {
  const root = initRepo();
  const baseline = Array.from({ length: baselineCount }, (_, i) => `base-${String(i).padStart(2, '0')}`);
  commitFile(root, P, `${baseline.join('\n')}\n`, 'seed P on origin/main');
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));

  commitFile(root, Q, `id: ${LANDING}\nstatus: todo\n`, `${LANDING}: the landing ticket's own file`);

  const own = Array.from({ length: ownCount }, (_, i) => `own-${String(i).padStart(2, '0')}`);
  const afterOwn = baseline.concat(own);
  commitFile(root, P, `${afterOwn.join('\n')}\n`, `${LANDING}: add its own lines to the shared path`);

  const sibling = Array.from({ length: siblingCount }, (_, i) => `sib-${String(i).padStart(2, '0')}`);
  const afterSibling = afterOwn.concat(sibling);
  commitFile(root, P, `${afterSibling.join('\n')}\n`, `${UNLANDED}: add its own lines to the shared path`);

  const kept = 'housekeeping-marker-not-on-origin';
  commitFile(root, P, `${afterSibling.concat([kept]).join('\n')}\n`, 'Restore bounced-ticket paths to origin/main after re-point.');

  return { root, commit: head(root), baseline, own, sibling, kept };
}

function ownPaths(root, commit) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(let [r (land-step-lib/own-paths "${root}" "${commit}" "${LANDING}" #{"${UNLANDED}"})]
  (println (json/generate-string
            {:paths (or (:paths r) [])
             :warning (:warning r)
             :passengers (vec (sort (or (:passengers r) #{})))
             :rebuilt (into {} (for [[p v] (or (:rebuilt r) {})]
                                 [p {:lines (:lines v) :excluded (vec (sort (:excluded v)))}]))})))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function sweepFixtures() {
  sweepStaleTmpDirs({ prefix: FIXTURE_PREFIX });
}

const CELLS = ['restore-excluded', 'add-remove-excluded', 'add-keep-refuses'];

test("BL-1857/BL-654 invariant: an untagged commit is left out of a shared path's attribution only when no line it added survives into the landing copy without also being on origin/main; every other untagged touch still refuses by name", () => {
  sweepFixtures();
  const reach = Object.fromEntries(CELLS.map((c) => [c, 0]));
  const CELL_RUNS = runsPerCell(4 * CELLS.length, CELLS.length);

  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 1, max: 3 }),
      fc.integer({ min: 1, max: 3 }),
      (baselineCount, ownCount, siblingCount) => {
        const { root, baseline, own, sibling } = buildRestoreFixture({ baselineCount, ownCount, siblingCount });
        try {
          reach['restore-excluded'] += 1;
          const plan = ownPaths(root, head(root));
          assert.equal(plan.warning, null, `own-paths refused despite a no-op untagged restore: ${JSON.stringify(plan)}`);
          assert.ok(plan.paths.includes(P), `${P} was dropped: ${JSON.stringify(plan)}`);

          const rebuilt = plan.rebuilt[P];
          assert.ok(rebuilt, `${P} was not reported as rebuilt: ${JSON.stringify(plan)}`);
          assert.deepEqual(rebuilt.excluded, [UNLANDED], `${P}'s rebuild does not credit ${UNLANDED}: ${JSON.stringify(plan)}`);
          for (const sibLine of sibling) {
            assert.ok(!rebuilt.lines.includes(sibLine), `${sibLine} (only ${UNLANDED}'s) reached the rebuilt content: ${JSON.stringify(rebuilt)}`);
          }
          assert.deepEqual(rebuilt.lines, baseline.concat(own), `rebuilt content is not origin/main's lines plus ${LANDING}'s own: ${JSON.stringify(rebuilt)}`);
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: CELL_RUNS }
  );

  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 1, max: 3 }),
      fc.integer({ min: 1, max: 3 }),
      (baselineCount, ownCount, siblingCount) => {
        const { root, baseline, own, sibling } = buildAddRemoveFixture({ baselineCount, ownCount, siblingCount });
        try {
          reach['add-remove-excluded'] += 1;
          const plan = ownPaths(root, head(root));
          assert.equal(plan.warning, null, `own-paths refused despite a net-zero untagged add/remove: ${JSON.stringify(plan)}`);
          assert.ok(plan.paths.includes(P), `${P} was dropped: ${JSON.stringify(plan)}`);

          const rebuilt = plan.rebuilt[P];
          assert.ok(rebuilt, `${P} was not reported as rebuilt: ${JSON.stringify(plan)}`);
          assert.deepEqual(rebuilt.excluded, [UNLANDED], `${P}'s rebuild does not credit ${UNLANDED}: ${JSON.stringify(plan)}`);
          assert.ok(!rebuilt.lines.includes('transient-scratch-row'), `the transient row leaked into the rebuild: ${JSON.stringify(rebuilt)}`);
          for (const sibLine of sibling) {
            assert.ok(!rebuilt.lines.includes(sibLine), `${sibLine} (only ${UNLANDED}'s) reached the rebuilt content: ${JSON.stringify(rebuilt)}`);
          }
          assert.deepEqual(rebuilt.lines, baseline.concat(own), `rebuilt content is not origin/main's lines plus ${LANDING}'s own: ${JSON.stringify(rebuilt)}`);
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: CELL_RUNS }
  );

  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 1, max: 3 }),
      fc.integer({ min: 1, max: 3 }),
      (baselineCount, ownCount, siblingCount) => {
        const { root, kept } = buildAddKeepFixture({ baselineCount, ownCount, siblingCount });
        try {
          reach['add-keep-refuses'] += 1;
          const plan = ownPaths(root, head(root));
          assert.equal(plan.paths.length, 0, `own-paths did not refuse a path with a real untagged content change: ${JSON.stringify(plan)}`);
          assert.ok(plan.warning && plan.warning.includes(P), `refusal does not name ${P}: ${JSON.stringify(plan)}`);
          assert.ok(plan.warning && plan.warning.includes(UNLANDED), `refusal does not name ${UNLANDED}: ${JSON.stringify(plan)}`);
          assert.ok(!(plan.rebuilt && plan.rebuilt[P] && plan.rebuilt[P].lines.includes(kept)), `the untagged kept line rode a rebuild it should have refused instead: ${JSON.stringify(plan)}`);
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: CELL_RUNS }
  );

  assertReachFloor(reach, CELLS, CELL_RUNS, 'BL-1857 own-paths cell');
}, propertyLaneTimeoutMs(20000));
