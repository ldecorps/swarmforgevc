'use strict';

// BL-1830's declared invariant (property authorship rests with the coder,
// first pass - BL-654):
//
//   "A land never publishes to origin/main a line that only an unlanded
//    sibling's commits introduced, in any path, whether or not the landing
//    ticket also changed that path."
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Drives the REAL swarmforge/scripts/land_step_lib.bb `own-paths` - the same
// public entry point BL-1717's own property test drives, and the function
// `shared-own-path-rebuild` (BL-1830's new private helper) feeds into -
// over a real git fixture, with `unlanded-siblings` given explicitly (the
// same 4-arg form land_step_lib_test_runner.bb's own BL-1830 unit tests
// use), never a JS restatement of the line-merge decision.
//
// GENERATOR REACH (by CONSTRUCTION, never by draw). Three cells:
//   'clean-separation' varies the baseline line count, the sibling's own
//   line count, how many of the landing ticket's own lines it removes (a
//   suffix of the baseline) and how many it adds - the landing ticket's own
//   change never touches a line the sibling introduced, so the rebuild
//   always succeeds and the invariant is checked on its actual content: not
//   one of the sibling's lines survives.
//   'escalate-on-shared-line-edit' derives the landing ticket's own removed
//   line DIRECTLY from the sibling's own added line (append a suffix to
//   build the "corrected" version) - the same transformation
//   bl1830SharedOwnPathCli.bb's "edit-sibling-row" shape uses - so every
//   generated case is a genuine collision by construction, never a drawn
//   pair that might happen to miss.
//   'untagged-touch-escalates' (D1, QA bounce 2026-09-30,
//   backlog/evidence/BL-1830-QA-20260930.md): the SAME clean, cleanly-
//   separable shape 'clean-separation' builds, PLUS one more commit on P
//   whose subject names NO ticket id at all (the shape QA's own routine
//   housekeeping commit took live, 'Restore bounced-ticket paths to
//   origin/main after re-point.', which QA.prompt requires carry no ticket
//   id). Every OTHER cell here is tagged-only by construction, which is
//   exactly why D1 shipped green through this property and the hand-written
//   unit suite alike - own-paths must now refuse by name rather than fall
//   through to the keep-whole-tip branch once an untagged touch is present,
//   however cleanly separable the tagged commits alone would have been.

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
const FIXTURE_PREFIX = 'bl1830-property-';

const LANDING = 'BL-9717';
const UNLANDED = 'BL-9799';
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
  // sibling is non-blocking (BL-1332/BL-1375's own older clause treats a
  // missing or unreadable ticket file as blocking and fails closed before
  // BL-1830's rebuild clause is ever reached).
  commitFile(
    root,
    `backlog/active/${UNLANDED}-sibling.yaml`,
    `id: ${UNLANDED}\nstatus: todo\nhuman_approval: approved\n`,
    `${UNLANDED}: the sibling's ticket`
  );
  return root;
}

/**
 * clean-separation: origin/main holds baseline lines B on P. The sibling's
 * own commit (tagged UNLANDED) appends its own lines to P, so its own patch
 * context is anchored on B's own tail. The landing ticket's own commit
 * (tagged LANDING) then ONLY APPENDS its own lines after the sibling's -
 * never touching a line of B, so B's tail (the sibling's own context) is
 * always intact and the rebuild must succeed. This is deliberately
 * addition-only: the same shape both BL-1830's own feature scenarios and
 * land_step_lib_test_runner.bb's "clean" fixtures use (a manifest gaining
 * two tickets' own new rows). A landing-ticket REMOVAL that reaches into
 * B's tail denies the sibling's own patch its context and correctly
 * escalates - `shared-own-path-rebuild`'s own documented, conservative
 * posture for a three-way apply that cannot find its own anchor (measured
 * directly: removing even one line of a 2-line baseline this way turns a
 * cleanly-separable change into a refusal) - not a case either the
 * existing hand-written tests or this property claims to cover.
 */
function buildCleanFixture({ baselineCount, siblingCount, ownCount }) {
  const root = initRepo();
  const baseline = Array.from({ length: baselineCount }, (_, i) => `base-${String(i).padStart(2, '0')}`);
  commitFile(root, P, baseline.length ? `${baseline.join('\n')}\n` : '', 'seed P on origin/main');
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));

  const sibling = Array.from({ length: siblingCount }, (_, i) => `sib-${String(i).padStart(2, '0')}`);
  const afterSibling = baseline.concat(sibling);
  commitFile(root, P, `${afterSibling.join('\n')}\n`, `${UNLANDED}: add its own lines to the shared path`);

  commitFile(root, Q, `id: ${LANDING}\nstatus: todo\n`, `${LANDING}: the landing ticket's own file`);

  const own = Array.from({ length: ownCount }, (_, i) => `own-${String(i).padStart(2, '0')}`);
  const afterLanding = afterSibling.concat(own);
  commitFile(root, P, `${afterLanding.join('\n')}\n`, `${LANDING}: add its own lines to the shared path`);

  return { root, commit: head(root), baseline, sibling, kept: baseline, own };
}

/**
 * escalate-on-shared-line-edit: the sibling's own commit adds exactly one
 * line to P. The landing ticket's own commit then "corrects" that EXACT
 * line (derived from it, not drawn independently) by appending a suffix -
 * its own removed set names a line only the sibling ever introduced, which
 * origin/main never had, so a three-way apply cannot separate the two.
 */
function buildEscalateFixture({ baselineCount, suffix }) {
  const root = initRepo();
  const baseline = Array.from({ length: baselineCount }, (_, i) => `base-${String(i).padStart(2, '0')}`);
  commitFile(root, P, baseline.length ? `${baseline.join('\n')}\n` : '', 'seed P on origin/main');
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));

  const siblingLine = `sib-collide-${suffix}`;
  commitFile(root, P, `${baseline.concat([siblingLine]).join('\n')}\n`, `${UNLANDED}: add its own line to the shared path`);

  commitFile(root, Q, `id: ${LANDING}\nstatus: todo\n`, `${LANDING}: the landing ticket's own file`);

  const correctedLine = `${siblingLine}-fixed`;
  commitFile(root, P, `${baseline.concat([correctedLine]).join('\n')}\n`, `${LANDING}: correct the sibling's own line`);

  return { root, commit: head(root), siblingLine };
}

/**
 * untagged-touch-escalates (BL-1830 D1): the same clean, cleanly-separable
 * shape buildCleanFixture builds (sibling's own tagged commit, then the
 * landing ticket's own tagged commit, pure appends, never touching a line
 * of the other's), PLUS a THIRD commit on P whose message names no ticket
 * id at all - a genuine, non-empty content change (an unrelated
 * housekeeping line neither ticket owns), so it is real attributing commit
 * own-range-touched-paths/path-owner-tickets both see, not a no-op.
 */
function buildUntaggedFixture({ baselineCount, siblingCount, ownCount }) {
  const root = initRepo();
  const baseline = Array.from({ length: baselineCount }, (_, i) => `base-${String(i).padStart(2, '0')}`);
  commitFile(root, P, baseline.length ? `${baseline.join('\n')}\n` : '', 'seed P on origin/main');
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));

  const sibling = Array.from({ length: siblingCount }, (_, i) => `sib-${String(i).padStart(2, '0')}`);
  const afterSibling = baseline.concat(sibling);
  commitFile(root, P, `${afterSibling.join('\n')}\n`, `${UNLANDED}: add its own lines to the shared path`);

  commitFile(root, Q, `id: ${LANDING}\nstatus: todo\n`, `${LANDING}: the landing ticket's own file`);

  const own = Array.from({ length: ownCount }, (_, i) => `own-${String(i).padStart(2, '0')}`);
  const afterLanding = afterSibling.concat(own);
  commitFile(root, P, `${afterLanding.join('\n')}\n`, `${LANDING}: add its own lines to the shared path`);

  const afterHousekeeping = afterLanding.concat(['housekeeping-marker']);
  commitFile(root, P, `${afterHousekeeping.join('\n')}\n`, 'Restore bounced-ticket paths to origin/main after re-point.');

  return { root, commit: head(root) };
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

const CELLS = ['clean-separation', 'escalate-on-shared-line-edit', 'untagged-touch-escalates'];

test('BL-1830/BL-654 invariant: a land never publishes an unlanded sibling\'s line on a shared own path, and refuses by name rather than guessing when the landing ticket\'s own change cannot be separated from it', () => {
  sweepFixtures();
  const reach = Object.fromEntries(CELLS.map((c) => [c, 0]));
  const CELL_RUNS = runsPerCell(4 * CELLS.length, CELLS.length);

  fc.assert(
    fc.property(
      // BL-1830 property test note: baselineCount starts at 1, never 0 -
      // an empty file's blob (0 bytes) round-trips through git as a
      // single blank "line" (`clojure.string/split-lines` on "" yields
      // [""], not []), an unrelated empty-file quirk this property is not
      // about; a non-empty baseline sidesteps it entirely.
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 1, max: 3 }),
      fc.integer({ min: 1, max: 3 }),
      (baselineCount, siblingCount, ownCount) => {
        const { root, kept, sibling, own } = buildCleanFixture({
          baselineCount,
          siblingCount,
          ownCount,
        });
        try {
          reach['clean-separation'] += 1;
          const plan = ownPaths(root, head(root));
          assert.equal(plan.warning, null, `own-paths refused a cleanly-separable change: ${JSON.stringify(plan)}`);
          assert.ok(plan.paths.includes(P), `${P} was dropped: ${JSON.stringify(plan)}`);
          assert.ok(!plan.passengers.includes(UNLANDED), `${UNLANDED} rode as a passenger, never a rebuild exclusion: ${JSON.stringify(plan)}`);

          const rebuilt = plan.rebuilt[P];
          assert.ok(rebuilt, `${P} was not reported as rebuilt: ${JSON.stringify(plan)}`);
          assert.deepEqual(rebuilt.excluded, [UNLANDED], `${P}'s rebuild does not credit ${UNLANDED}: ${JSON.stringify(plan)}`);

          // The invariant itself: not one of the sibling's own lines survives.
          for (const sibLine of sibling) {
            assert.ok(!rebuilt.lines.includes(sibLine), `${sibLine} (only ${UNLANDED}'s) reached the rebuilt content: ${JSON.stringify(rebuilt)}`);
          }
          assert.deepEqual(rebuilt.lines, kept.concat(own), `rebuilt content is not origin/main's kept lines plus ${LANDING}'s own: ${JSON.stringify(rebuilt)}`);
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: CELL_RUNS }
  );

  fc.assert(
    fc.property(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 999999 }), (baselineCount, suffix) => {
      const { root } = buildEscalateFixture({ baselineCount, suffix });
      try {
        reach['escalate-on-shared-line-edit'] += 1;
        const plan = ownPaths(root, head(root));
        assert.equal(plan.paths.length, 0, `own-paths did not refuse an unseparable own change: ${JSON.stringify(plan)}`);
        assert.ok(plan.warning && plan.warning.includes(P), `refusal does not name ${P}: ${JSON.stringify(plan)}`);
        assert.ok(plan.warning && plan.warning.includes(UNLANDED), `refusal does not name ${UNLANDED}: ${JSON.stringify(plan)}`);
        return true;
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: CELL_RUNS }
  );

  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 1, max: 3 }),
      fc.integer({ min: 1, max: 3 }),
      (baselineCount, siblingCount, ownCount) => {
        const { root } = buildUntaggedFixture({ baselineCount, siblingCount, ownCount });
        try {
          reach['untagged-touch-escalates'] += 1;
          const plan = ownPaths(root, head(root));
          assert.equal(plan.paths.length, 0, `own-paths did not refuse a path with an untagged touch: ${JSON.stringify(plan)}`);
          assert.ok(plan.warning && plan.warning.includes(P), `refusal does not name ${P}: ${JSON.stringify(plan)}`);
          assert.ok(plan.warning && plan.warning.includes(UNLANDED), `refusal does not name ${UNLANDED}: ${JSON.stringify(plan)}`);
          assert.ok(!plan.passengers.includes(UNLANDED), `${UNLANDED} rode as a passenger instead of an escalation: ${JSON.stringify(plan)}`);
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: CELL_RUNS }
  );

  assertReachFloor(reach, CELLS, CELL_RUNS, 'BL-1830 own-paths cell');
}, propertyLaneTimeoutMs(20000));
