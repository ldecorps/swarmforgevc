'use strict';

// BL-1650's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  The land step decides a closed-owner stray on its own
//                only when every path the stray commit touches is under
//                backlog/evidence/ or docs/; one path outside that set
//                makes the whole stray an escalation, exactly as today.
//   invariant 2  A stray the step lands is recorded: the land log names
//                the cherry-picked commit, its source sha and its paths,
//                and the landed commit carries the -x trailer; nothing
//                lands silently (BL-1546).
//
// Drives the REAL swarmforge/scripts/land_step_lib.bb / land_step_cli.bb
// against real git fixtures - never a JavaScript restatement of either
// decision.
//
// GENERATOR REACH (reached by construction, never by draw). Invariant 1
// needs both of its outcomes exercised: an all-pure path set (kept as a
// cherry-pick candidate) and the same set with exactly one non-pure path
// mixed in (rejected outright) - each its own shape. Invariant 2 needs
// more than the single-path case exercised: the stray touching 1, 2 and 3
// pure-evidence/doc paths at once, so the recorded log line and the -x
// trailer are checked against a real multi-path stray, not only the
// everyday single-file incident note.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');
const FIXTURE_PREFIX = 'bl1650-property-';
const LANDING = 'BL-9650';
const SIBLING = 'BL-9651';

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function gitOut(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function head(root) {
  return gitOut(root, 'rev-parse', 'HEAD');
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

function markOriginMain(root) {
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));
}

function writeDoneTicket(root, id) {
  commitFile(
    root,
    `backlog/done/M8/${id}-fixture.yaml`,
    `id: ${id}\nstatus: done\nhuman_approval: approved\n`,
    `${id}: done ticket fixture file`,
  );
}

function initRepo(root) {
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
}

function runCli(root, taskName, commit) {
  const r = spawnSync('bb', [CLI, taskName, commit], { cwd: root, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ── invariant 1: the pure classifier, driven directly (no git needed) ────

function pureEvidenceOrDocsPaths(paths) {
  const literal = `[${paths.map((p) => JSON.stringify(p)).join(' ')}]`;
  const program = `(load-file "${LAND_STEP_LIB}") (println (land-step-lib/pure-evidence-or-docs-paths? ${literal}))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return r.stdout.trim().split('\n').pop() === 'true';
}

const PURE_PATH_POOL = [
  'backlog/evidence/BL-9651-note-a.md',
  'backlog/evidence/BL-9651-note-b.md',
  'docs/how-to/BL-9651-guide.md',
  'docs/reference/BL-9651-spec.md',
];

const IMPURE_PATH_POOL = [
  'extension/src/tools/shared-tool.ts',
  'swarmforge/scripts/shared_lib.bb',
  'specs/features/shared.feature',
  'specs/pipeline/steps/sharedSteps.js',
  'android/app/src/main/Shared.kt',
  'pwa/index.html',
  'backlog/active/BL-9999-fixture.yaml',
  'backlog/done/M8/BL-9999-fixture.yaml',
  'backlog/scripts/suite-manifest.tsv',
];

test('BL-1650/BL-654 invariant 1: a stray is decided on its own only when EVERY path is pure evidence/docs - one path outside the set escalates the whole stray', () => {
  const shapes = ['all-pure', 'one-impure'];
  const reach = Object.fromEntries(shapes.map((s) => [s, 0]));
  const RUNS = runsPerCell(4 * shapes.length, shapes.length);

  for (const shape of shapes) {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(PURE_PATH_POOL, { minLength: 1, maxLength: PURE_PATH_POOL.length }),
        fc.constantFrom(...IMPURE_PATH_POOL),
        (purePaths, impurePath) => {
          reach[shape] += 1;
          if (shape === 'all-pure') {
            assert.equal(
              pureEvidenceOrDocsPaths(purePaths),
              true,
              `expected an all-pure path set to classify as pure: ${JSON.stringify(purePaths)}`,
            );
          } else {
            assert.equal(
              pureEvidenceOrDocsPaths([...purePaths, impurePath]),
              false,
              `expected one impure path to disqualify the whole set: ${JSON.stringify([...purePaths, impurePath])}`,
            );
          }
          return true;
        },
      ),
      { numRuns: RUNS },
    );
  }

  assertReachFloor(reach, shapes, RUNS, 'pure-evidence-classification shape');
});

// ── invariant 2: the recorded land, end to end against a real CLI run ───

function buildStrayLandsFixture(paths) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  initRepo(root);
  commitFile(root, 'seed.txt', 'seed\n', 'seed before origin/main');
  markOriginMain(root);
  git(root, 'checkout', '-q', '-b', 'role');
  for (const p of paths) {
    const abs = path.join(root, p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${p} incident content\n`);
  }
  git(root, 'add', '-A');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `${SIBLING}: incident evidence across ${paths.length} path(s)`);
  const strayCommit = head(root);
  git(root, 'checkout', '-q', 'main');
  writeDoneTicket(root, SIBLING);
  markOriginMain(root);
  git(root, 'checkout', '-q', 'role');
  commitFile(root, `backlog/active/${LANDING}-fixture.yaml`, `id: ${LANDING}\n`, `${LANDING}: own work`);
  return { root, strayCommit };
}

test('BL-1650/BL-654 invariant 2: a landed stray is recorded - the log names the cherry-picked commit, its source sha and its paths, and the landed commit carries the -x trailer', () => {
  const shapes = [1, 2, 3];
  const reach = Object.fromEntries(shapes.map((n) => [n, 0]));
  const RUNS = runsPerCell(3 * shapes.length, shapes.length);

  for (const n of shapes) {
    fc.assert(
      fc.property(fc.shuffledSubarray(PURE_PATH_POOL, { minLength: n, maxLength: n }), (paths) => {
        const { root, strayCommit } = buildStrayLandsFixture(paths);
        try {
          reach[n] += 1;
          const cli = runCli(root, `${LANDING}-fixture`, head(root));
          assert.equal(cli.status, 0, `expected LAND_REPLAY (exit 0), got: ${JSON.stringify(cli)}`);
          assert.ok(cli.stdout.includes('LAND_REPLAY'), `expected LAND_REPLAY, got: ${cli.stdout}`);

          const branchLine = cli.stdout.split('\n').find((l) => l.startsWith('LAND_REPLAY'));
          assert.ok(branchLine, `expected a LAND_REPLAY line, got: ${cli.stdout}`);
          const branch = branchLine.split(' ')[1];

          // LAND_STRAY_EVIDENCE_LANDED "<sha> -> <landed-sha> <paths>" names
          // the CHERRY-PICKED commit's own sha, the intermediate commit the
          // cherry-pick produced on the replay branch (never the final
          // tip-pure commit the LAND_REPLAY line names - the parcel's own
          // commit still lands ON TOP of it) and its paths.
          const line = cli.stdout.split('\n').find((l) => l.startsWith('LAND_STRAY_EVIDENCE_LANDED'));
          assert.ok(line, `expected a LAND_STRAY_EVIDENCE_LANDED line, got: ${cli.stdout}`);
          const parts = line.split(' ');
          assert.equal(parts[1], strayCommit, `line does not name the stray's own commit: ${line}`);
          assert.equal(parts[2], '->', `unexpected LAND_STRAY_EVIDENCE_LANDED format: ${line}`);
          const landedSha = parts[3];
          for (const p of paths) {
            assert.ok(line.includes(p), `line does not name path ${p}: ${line}`);
          }

          const commitMsg = gitOut(root, 'log', '-1', '--format=%B', landedSha);
          assert.ok(
            commitMsg.includes(`(cherry picked from commit ${strayCommit})`),
            `landed commit ${landedSha} is missing the -x trailer for ${strayCommit}: ${commitMsg}`,
          );

          spawnSync('git', ['-C', root, 'branch', '-q', '-D', branch]);
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: RUNS },
    );
  }

  assertReachFloor(reach, shapes, RUNS, 'stray path-count shape');
});
