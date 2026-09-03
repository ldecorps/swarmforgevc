'use strict';

// BL-1375's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  Nothing the human has not approved reaches main by any route
//                this ticket opens: a sibling that is withheld, in
//                backlog/hold, awaiting approval, or whose approval state
//                cannot be READ still blocks, and is still named in the
//                refusal.
//   invariant 2  A passenger's content rides into main only if the replayed
//                tree is self-consistent on main: the land runs
//                check_feature_handler_registration.sh against the replayed
//                tree before publish, and a failure refuses the land naming
//                the passenger - never a raw publish.
//   invariant 3  No route added here bypasses the task-scope gate's own
//                refusal of out-of-scope content - it is satisfied, never
//                skipped.
//
// Drives the REAL swarmforge/scripts/land_step_lib.bb and the REAL
// check_feature_handler_registration.sh against real git fixtures - never a
// JavaScript restatement of either decision.
//
// GENERATOR REACH (reached by CONSTRUCTION, never by draw). The narrowing
// this ticket makes turns on ONE question - what approval state does the
// co-owning sibling have - so every state is its own property pass:
// approved, awaiting, withheld, unreadable, and the absent field that
// backlog-schema.md defines as "no approval needed". A draw over states
// would leave the blocking corners to luck, and the whole risk the human
// named in accepting option 1 is that a state read goes wrong. Invariant 2's
// pass constructs the two tree shapes the same way: a passenger whose
// registry line dangles, and one whose target is already on main.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const FIXTURE_PREFIX = 'bl1375-property-';
const LANDING = 'BL-9375';
const SIBLING = 'BL-9376';
const SHARED_PATH = 'specs/pipeline/steps/index.js';
const SIBLING_HANDLER = 'specs/pipeline/steps/bl9376FixtureSteps.js';
const SIBLING_LINE = "require('./bl9376FixtureSteps')";

// Every approval state the narrowed predicate can meet, and whether it may
// ride. `absent` is not an oversight: backlog-schema.md defines a missing
// human_approval as "no approval needed" and promotion_gates_lib.bb's own
// gate already passes it, so it is neither withheld nor awaiting.
const APPROVAL_SHAPES = [
  { name: 'approved', folder: 'active', field: 'human_approval: approved\n', blocks: false },
  { name: 'absent', folder: 'active', field: '', blocks: false },
  { name: 'awaiting', folder: 'active', field: 'human_approval: pending\n', blocks: true },
  { name: 'rejected', folder: 'active', field: 'human_approval: rejected\n', blocks: true },
  { name: 'withheld', folder: 'hold', field: 'human_approval: approved\n', blocks: true },
  { name: 'unreadable', folder: null, field: null, blocks: true },
];

const registry = (lines) => `const DOMAINS = [\n${lines.map((l) => `  ${l},\n`).join('')}];\n`;

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
}

function head(root) {
  return git(root, 'rev-parse', 'HEAD').trim();
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

// The shared path is a real step registry, and the sibling's contribution to
// it is a require line: that is the shape that actually froze main (BL-1324),
// so invariant 2 has something real to be about.
function buildFixture(shape, extraPath) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(root, 'specs', 'pipeline', 'steps'), { recursive: true });
  fs.writeFileSync(path.join(root, SHARED_PATH), registry([]));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed the step registry');
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));

  // The landing ticket always contributes a path of its own, so an empty
  // contribution never stands in for the disposition under test.
  commitFile(root, extraPath, 'anchor\n', `${LANDING}: anchor path`);
  commitFile(root, SHARED_PATH, registry([`// ${LANDING} line`]), `${LANDING}: own work on the registry`);
  commitFile(
    root,
    SHARED_PATH,
    registry([`// ${LANDING} line`, SIBLING_LINE]),
    `${SIBLING}: the sibling's line in the same file`,
  );
  commitFile(root, SIBLING_HANDLER, 'module.exports = { registerSteps() {} };\n', `${SIBLING}: its own handler file`);

  if (shape.folder !== null) {
    const dir = path.join(root, 'backlog', shape.folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${SIBLING}-fixture.yaml`), `id: ${SIBLING}\nstatus: todo\n${shape.field}`);
  }
  return root;
}

// Advances origin/main itself to carry `rel`, via plumbing - the file is ON
// MAIN, not merely committed on the tip where the replay would exclude it as
// the sibling's own path. That distinction is what invariant 2 turns on.
function putOnMain(root, rel, body) {
  const base = git(root, 'rev-parse', 'refs/remotes/origin/main').trim();
  const index = path.join(root, '.git', 'bl1375-property-index');
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const plumb = (args, input) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', input }).trim();
  plumb(['read-tree', base]);
  const blob = plumb(['hash-object', '-w', '--stdin'], body);
  plumb(['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`]);
  const tree = plumb(['write-tree']);
  const commit = plumb(['commit-tree', tree, '-p', base, '-m', `main already carries ${rel}`]);
  git(root, 'update-ref', 'refs/remotes/origin/main', commit);
  fs.rmSync(index, { force: true });
}

function askLandStep(root, expression) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string ${expression}))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

const ownPaths = (root) =>
  askLandStep(root, `(land-step-lib/own-paths "${root}" "${head(root)}" "${LANDING}" #{"${SIBLING}"})`);

const landPlan = (root) =>
  askLandStep(root, `(land-step-lib/land-plan {:root "${root}" :commit "${head(root)}" :task-ticket-id "${LANDING}"})`);

const blobAtTip = (root, rel) => git(root, 'show', `HEAD:${rel}`);

// The task-scope gate's OWN walk, asked directly: what does this tip deliver
// between origin/main and HEAD? Invariant 3 is that the replay never reaches
// outside it.
function deliveredPaths(root) {
  return git(root, 'diff', '--name-only', `refs/remotes/origin/main..HEAD`)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

const extraPathArb = fc.constantFrom('landing/anchor.txt', 'docs/reference/notes.md', 'swarmforge/scripts/thing.sh');

test('BL-1375/BL-654 invariant 1: a sibling that is not positively approved still blocks, and is named', () => {
  const reach = Object.fromEntries(APPROVAL_SHAPES.map((s) => [s.name, 0]));

  for (const shape of APPROVAL_SHAPES) {
    fc.assert(
      fc.property(extraPathArb, (extraPath) => {
        const root = buildFixture(shape, extraPath);
        try {
          reach[shape.name] += 1;
          const result = ownPaths(root);

          if (shape.blocks) {
            assert.equal(result.paths, null, `the ${shape.name} sibling did not block: ${JSON.stringify(result)}`);
            const warning = result.warning || '';
            assert.ok(warning.includes(SIBLING), `the refusal does not name the sibling: ${warning}`);
            assert.ok(warning.includes(SHARED_PATH), `the refusal does not name the shared path: ${warning}`);
            assert.ok(warning.includes(LANDING), `the refusal does not name the landing ticket: ${warning}`);
          } else {
            // The narrowing must actually narrow: a fix that refused every
            // state would satisfy the blocking half and leave the deadlock.
            assert.ok(
              Array.isArray(result.paths) && result.paths.includes(SHARED_PATH),
              `the ${shape.name} sibling still blocked the shared path: ${JSON.stringify(result)}`,
            );
          }

          // Whatever survives into the replay set is taken WHOLE, so under a
          // blocking state no replayed path may carry the sibling's line.
          if (shape.blocks) {
            for (const p of result.paths || []) {
              assert.ok(
                !blobAtTip(root, p).includes(SIBLING_LINE),
                `${p} would ship a ${shape.name} sibling's line`,
              );
            }
          }
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 3 },
    );
  }

  for (const shape of APPROVAL_SHAPES) {
    assert.ok(reach[shape.name] > 0, `never exercised the ${shape.name} approval state`);
  }
  assert.ok(
    APPROVAL_SHAPES.some((s) => s.blocks) && APPROVAL_SHAPES.some((s) => !s.blocks),
    'the shape table lost one side of the contrast',
  );
});

test('BL-1375/BL-654 invariant 2: a passenger rides only through a self-consistent replayed tree', () => {
  const approved = APPROVAL_SHAPES.find((s) => s.name === 'approved');
  const reach = { dangling: 0, resolved: 0 };

  for (const consistent of [false, true]) {
    fc.assert(
      fc.property(extraPathArb, (extraPath) => {
        const root = buildFixture(approved, extraPath);
        try {
          // The passenger's registry line reaches for its handler file, which
          // is the sibling's OWN path and therefore excluded from the replay.
          // Putting it on main is the only thing that makes the replayed tree
          // self-consistent - which is exactly the question the rider asks.
          if (consistent) putOnMain(root, SIBLING_HANDLER, 'module.exports = { registerSteps() {} };\n');

          const plan = landPlan(root);
          assert.equal(plan.action, 'replay', `the plan refused before the guard could speak: ${JSON.stringify(plan)}`);
          const passengers = plan.passengers || [];
          assert.ok(passengers.includes(SIBLING), `no passenger rode, so this run proves nothing about the guard`);

          const result = askLandStep(
            root,
            `(land-step-lib/replay! {:root "${root}" :commit "${head(root)}" :task-ticket-id "${LANDING}"` +
              ` :own-paths ${JSON.stringify(plan['own-paths'])} :passengers #{${passengers
                .map((s) => `"${s}"`)
                .join(' ')}}})`,
          );

          if (consistent) {
            reach.resolved += 1;
            assert.equal(result.success, true, `a self-consistent replayed tree was refused: ${JSON.stringify(result)}`);
            git(root, 'branch', '-q', '-D', result.branch);
          } else {
            reach.dangling += 1;
            assert.equal(result.success, false, `an inconsistent replayed tree was published: ${JSON.stringify(result)}`);
            assert.ok(result.reason.includes(SIBLING), `the refusal does not name the passenger: ${result.reason}`);
            // Nothing is left behind for anyone to land by accident.
            assert.equal(
              git(root, 'worktree', 'list').trim().split('\n').length,
              1,
              'a scratch worktree survived the refusal',
            );
          }
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 2 },
    );
  }

  assert.ok(reach.dangling > 0, 'never exercised a dangling passenger line - the BL-1324 corner went untested');
  assert.ok(reach.resolved > 0, 'never exercised a resolved passenger line - the guard could be refusing everything');
});

test('BL-1375/BL-654 invariant 3: the replay never reaches outside what the tip actually delivers', () => {
  let checked = 0;

  for (const shape of APPROVAL_SHAPES) {
    fc.assert(
      fc.property(extraPathArb, (extraPath) => {
        const root = buildFixture(shape, extraPath);
        try {
          const result = ownPaths(root);
          const delivered = new Set(deliveredPaths(root));
          for (const p of result.paths || []) {
            checked += 1;
            // The narrowed route adds no way for a path outside the tip's own
            // delivered diff to enter the replay. Out-of-scope content is
            // still refused by the same walk the task-scope gate uses; this
            // ticket satisfies that gate rather than stepping around it.
            assert.ok(delivered.has(p), `${p} entered the replay without being delivered by the tip`);
          }
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 2 },
    );
  }

  assert.ok(checked > 0, 'no replayed path was ever examined, so this property asserted nothing');
});
