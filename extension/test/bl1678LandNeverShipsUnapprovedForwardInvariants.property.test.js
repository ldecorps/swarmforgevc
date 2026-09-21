'use strict';

// BL-1678's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  No commit reaches origin/main through a land unless every
//                path it changes against origin/main is attributed to the
//                landing ticket or to a ticket already landed; an
//                unapproved forward merged into QA's branch never rides,
//                whichever paths it touches.
//   invariant 2  origin/main's first-parent line advances only by tip-pure
//                landing commits and by writers on main itself; a land
//                never pushes a merge commit as main.
//
// Drives the REAL swarmforge/scripts/land_step_cli.bb and
// land_main_publish.sh against real git fixtures (a bare origin, never the
// live checkout - BL-1390) - never a JavaScript restatement of land-plan,
// replay!, or the publish step's own verify-push-safe guard.
//
// GENERATOR REACH (reached by construction, never by draw). Invariant 1
// needs the unapproved sibling's own path COUNT varied (1..3) and its
// ancestry POSITION varied relative to the landing ticket's own commits
// (before all of them, between two of them, after all of them) - the same
// shape BL-1461 exists to cover, since a candidate walk bounded the wrong
// way is exactly what let a pre-hop sibling through undetected. Invariant 2
// needs both refusal SHAPES exercised (a genuine multi-parent merge tip;
// a single-parent tip whose own ancestry still carries a foreign path) and
// the ACCEPT shape (a genuinely clean single-parent, own-paths-only
// commit) - a generator that only ever produced merges would prove nothing
// about the foreign-path half of the guard, and one that only ever refused
// would prove nothing about the guard ever letting a real land through.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LAND_STEP_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');
const LAND_MAIN_PUBLISH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_main_publish.sh');

const LANDING = 'BL-9678';
const SIBLING = 'BL-9679';
const FIXTURE_PREFIX = 'bl1678-property-';

function git(root, ...args) {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
}

function gitOut(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function head(root) {
  return gitOut(root, 'rev-parse', 'HEAD');
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message);
  return head(root);
}

function initRepo(root) {
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'commit.gpgsign', 'false');
}

function runCli(root, taskName, commit) {
  const r = spawnSync('bb', [LAND_STEP_CLI, taskName, commit, root], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ── invariant 1 ────────────────────────────────────────────────────────

const OWN_PATH_POOL = ['a-one.yaml', 'a-two.yaml', 'a-three.yaml'].map((n) => `backlog/active/${LANDING}-${n}`);
const SIBLING_PATH_POOL = ['s-one.txt', 's-two.txt', 's-three.txt'];

// Builds: N landing commits for LANDING (own-path pool, in order), with the
// sibling's own commit (siblingPaths, all in ONE commit) inserted at
// `position` among them - never landed on origin/main.
function buildInvariant1Fixture(ownPaths, siblingPaths, position) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  initRepo(root);
  commitFile(root, 'seed.txt', 'seed\n', 'seed');
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));

  const commitSibling = () => {
    for (const p of siblingPaths) {
      const abs = path.join(root, p);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, `${p}\n`);
    }
    git(root, 'add', '-A');
    git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `${SIBLING}: unapproved forward`);
  };

  if (position === 'before') commitSibling();
  ownPaths.forEach((p, i) => {
    commitFile(root, p, `${p}\n`, `${LANDING}: own work ${i}`);
    if (position === 'between' && i === 0 && ownPaths.length > 1) commitSibling();
  });
  if (position === 'after' || (position === 'between' && ownPaths.length < 2)) commitSibling();

  return root;
}

test('BL-1678/BL-654 invariant 1: an unapproved forward never rides, whichever paths it touches or where its commit sits', { timeout: 120000 }, () => {
  const positions = ['before', 'between', 'after'];
  const ownCounts = [1, 2, 3];
  const cells = positions.length * ownCounts.length;
  const RUNS = runsPerCell(3 * cells, cells);
  const reach = {};
  for (const pos of positions) for (const n of ownCounts) reach[`${pos}/${n}`] = 0;

  for (const position of positions) {
    for (const ownCount of ownCounts) {
      const ownPaths = OWN_PATH_POOL.slice(0, ownCount);
      fc.assert(
        fc.property(
          fc.shuffledSubarray(SIBLING_PATH_POOL, { minLength: 1, maxLength: SIBLING_PATH_POOL.length }),
          (siblingPaths) => {
            reach[`${position}/${ownCount}`] += 1;
            const root = buildInvariant1Fixture(ownPaths, siblingPaths, position);
            try {
              const tip = head(root);
              const result = runCli(root, `${LANDING}-fixture`, tip);
              assert.equal(result.status, 0, `expected the land step to succeed, got: ${JSON.stringify(result)}`);
              assert.match(
                result.stdout,
                new RegExp(`^ENTANGLED_SIBLING ${SIBLING}$`, 'm'),
                `expected the unapproved sibling named as entangled, got:\n${result.stdout}`,
              );
              const match = /^LAND_REPLAY (\S+) (\S+)$/m.exec(result.stdout);
              assert.ok(match, `expected LAND_REPLAY (never LAND_CLEAN) for an unlanded sibling, got:\n${result.stdout}`);
              const [, branch, builtCommit] = match;
              const diffPaths = gitOut(root, 'diff', '--name-only', 'origin/main', builtCommit)
                .split('\n')
                .filter(Boolean);
              for (const sp of siblingPaths) {
                assert.ok(!diffPaths.includes(sp), `expected ${sp} absent from the built commit, got: ${JSON.stringify(diffPaths)}`);
              }
              for (const op of ownPaths) {
                assert.ok(diffPaths.includes(op), `expected ${op} present in the built commit, got: ${JSON.stringify(diffPaths)}`);
              }
              git(root, 'branch', '-q', '-D', branch);
              return true;
            } finally {
              fs.rmSync(root, { recursive: true, force: true });
            }
          },
        ),
        { numRuns: RUNS },
      );
    }
  }

  assertReachFloor(reach, Object.keys(reach), RUNS, 'sibling position/own-path-count shape');
});

// ── invariant 2 ────────────────────────────────────────────────────────

function buildPushFixture() {
  const work = mkTmpDir(FIXTURE_PREFIX);
  const originDir = path.join(work, 'origin.git');
  const repoDir = path.join(work, 'repo');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', originDir]);
  execFileSync('git', ['init', '-q', '-b', 'main', repoDir]);
  git(repoDir, 'config', 'user.email', 't@t');
  git(repoDir, 'config', 'user.name', 't');
  git(repoDir, 'config', 'commit.gpgsign', 'false');
  git(repoDir, 'remote', 'add', 'origin', originDir);
  commitFile(repoDir, 'seed.txt', 'seed\n', 'seed');
  git(repoDir, 'push', '-q', 'origin', 'main');
  return { work, originDir, repoDir };
}

function runPush(repoDir, commit) {
  const r = spawnSync('bash', [LAND_MAIN_PUBLISH, repoDir, '--push', commit], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function originMainParentCount(originDir) {
  const tip = gitOut(originDir, 'rev-parse', 'main');
  const tokens = gitOut(originDir, 'rev-list', '--parents', '-n1', tip).split(/\s+/).filter(Boolean);
  return tokens.length - 1;
}

test('BL-1678/BL-654 invariant 2: origin/main never gains a merge commit through the publish step - a merge tip and a foreign-path single-parent tip both refuse, a genuinely clean one lands', () => {
  const shapes = ['merge-2-parents', 'merge-3-parents', 'foreign-path', 'clean'];
  const RUNS = runsPerCell(3 * shapes.length, shapes.length);
  const reach = Object.fromEntries(shapes.map((s) => [s, 0]));

  for (const shape of shapes) {
    fc.assert(
      fc.property(fc.constant(shape), () => {
        reach[shape] += 1;
        const { originDir, repoDir } = buildPushFixture();
        const before = gitOut(originDir, 'rev-parse', 'main');
        let candidate;

        if (shape === 'merge-2-parents' || shape === 'merge-3-parents') {
          const extraParents = shape === 'merge-2-parents' ? 1 : 2;
          const parentShas = [];
          for (let i = 0; i < extraParents; i += 1) {
            git(repoDir, 'checkout', '-q', 'main');
            git(repoDir, 'checkout', '-q', '-b', `line-${i}-${Math.random().toString(36).slice(2)}`);
            parentShas.push(commitFile(repoDir, `line-${i}.txt`, 'x\n', `${SIBLING}: unlanded line ${i}`));
          }
          git(repoDir, 'checkout', '-q', 'main');
          commitFile(repoDir, `${LANDING}-own.txt`, 'own\n', `${LANDING}: own work`);
          git(repoDir, 'merge', '-q', '--no-ff', '-m', 'Merge lines into main.', ...parentShas);
          candidate = head(repoDir);
        } else if (shape === 'foreign-path') {
          git(repoDir, 'checkout', '-q', '-b', 'b-line');
          const bSha = commitFile(repoDir, 'foreign.txt', 'b\n', `${SIBLING}: unapproved forward`);
          git(repoDir, 'checkout', '-q', 'main');
          commitFile(repoDir, `${LANDING}-own.txt`, 'own\n', `${LANDING}: own work`);
          git(repoDir, 'merge', '-q', '--no-ff', '-m', 'Merge b-line into main.', bSha);
          candidate = commitFile(repoDir, `${LANDING}-evidence.txt`, 'evidence\n', `${LANDING}: further own work`);
        } else {
          git(repoDir, 'checkout', '-q', 'main');
          candidate = commitFile(repoDir, `${LANDING}-own.txt`, 'own\n', `${LANDING}: own work`);
        }

        try {
          const result = runPush(repoDir, candidate);
          if (shape === 'clean') {
            assert.equal(result.status, 0, `expected a clean own-paths-only commit to be accepted, got: ${result.out}`);
            assert.equal(gitOut(originDir, 'rev-parse', 'main'), candidate, `expected origin/main to advance to the pushed commit`);
          } else {
            assert.notEqual(result.status, 0, `expected a refusal, got 0: ${result.out}`);
            assert.equal(gitOut(originDir, 'rev-parse', 'main'), before, `expected origin/main untouched by a refused push`);
          }
          assert.ok(originMainParentCount(originDir) <= 1, `expected origin/main's tip to never have more than one parent`);
          return true;
        } finally {
          fs.rmSync(path.dirname(originDir), { recursive: true, force: true });
        }
      }),
      { numRuns: RUNS },
    );
  }

  assertReachFloor(reach, shapes, RUNS, 'push-safety shape');
});
