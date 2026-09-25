'use strict';

// BL-1728's one declared invariant: "The watchdog test's fixture root is
// its own git checkout, and no git command in the test resolves to the
// live repository."
//
// Drives the REAL test_operator_runtime_babysitterd_watchdog.sh's own
// prove_git_fixture_root/init_git_fixture_root function bodies - extracted
// by source position, never retyped, via
// specs/pipeline/steps/lib/bl1728GitFixtureRootProofCli.sh (BL-1516's own
// convention) - against real mkdtemp directories and a real enclosing
// repository, never a mock of git.
//
// GENERATOR REACH (by construction, never by draw): every shape the
// invariant quantifies over is driven at least once - a freshly git-init'd
// fixture that passes the proof (the watchdog test's own path), a plain
// directory that is not a git checkout at all, and a directory nested
// inside a live enclosing checkout but never itself git-inited (the exact
// shape a fixture reachable only via a parent .git would take - this is
// the hazard class Guardrails/BL-1390 names).
//
// Non-vacuous, verified by hand: with prove_git_fixture_root's
// `--path-format=absolute` swapped back for a plain `--git-common-dir`
// (its pre-fix form), the "outside" shape below fails - a relative
// "../../.git" climb string-prefix-matches "$d/" and is wrongly accepted.
// Restored before landing.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'lib', 'bl1728GitFixtureRootProofCli.sh');

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function initEnclosingRepo(root) {
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'seed');
}

function snapshot(root) {
  return { branches: git(root, 'branch', '--list'), head: git(root, 'rev-parse', 'HEAD') };
}

const SHAPES = ['good', 'not-a-repo', 'outside'];

test('BL-1728/BL-654 invariant: a fixture root is proven as its own checkout, and a subdirectory of a live enclosing checkout is always refused, never mistaken for its own', () => {
  const RUNS = runsPerCell(3 * SHAPES.length, SHAPES.length);
  const reach = Object.fromEntries(SHAPES.map((s) => [s, 0]));

  for (const shape of SHAPES) {
    fc.assert(
      fc.property(fc.constant(shape), () => {
        reach[shape] += 1;
        const work = mkTmpDir('bl1728-property-');
        try {
          if (shape === 'good') {
            const tmproot = path.join(work, 'tmproot');
            fs.mkdirSync(tmproot, { recursive: true });
            const result = spawnSync('bash', [CLI, 'good', tmproot], { encoding: 'utf8' });
            assert.equal(result.status, 0, `expected a clean exit, got ${result.status}: ${result.stderr}`);
            const fixtureRoot = result.stdout.trim();
            assert.ok(fixtureRoot.startsWith(tmproot), `expected the fixture under ${tmproot}, got: ${fixtureRoot}`);
            const commonDir = git(fixtureRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir');
            assert.ok(
              commonDir === path.join(fixtureRoot, '.git') || commonDir.startsWith(`${fixtureRoot}${path.sep}`),
              `expected ${fixtureRoot}'s own .git, got: ${commonDir}`,
            );
            return true;
          }

          if (shape === 'not-a-repo') {
            const plainDir = path.join(work, 'plain-dir');
            fs.mkdirSync(plainDir, { recursive: true });
            const result = spawnSync('bash', [CLI, 'not-a-repo', plainDir], { encoding: 'utf8' });
            assert.notEqual(result.status, 0, `expected a refusal for a non-repository directory, got 0`);
            assert.ok(
              `${result.stdout}${result.stderr}`.includes(plainDir),
              `expected the refusal to name ${plainDir}, got: ${result.stdout}${result.stderr}`,
            );
            return true;
          }

          // shape === 'outside': a directory nested inside a real, live
          // enclosing checkout, but never itself git-inited - the exact
          // shape prove_git_fixture_root exists to refuse.
          const enclosing = path.join(work, 'enclosing');
          initEnclosingRepo(enclosing);
          const before = snapshot(enclosing);
          const nested = path.join(enclosing, 'nested', 'dir');
          fs.mkdirSync(nested, { recursive: true });
          const result = spawnSync('bash', [CLI, 'outside', nested], { encoding: 'utf8' });
          assert.notEqual(result.status, 0, `expected a refusal for a subdirectory of a live checkout, got 0`);
          const out = `${result.stdout}${result.stderr}`;
          assert.ok(out.includes(nested), `expected the refusal to name ${nested}, got: ${out}`);
          assert.ok(
            out.includes(path.join(enclosing, '.git')),
            `expected the refusal to name the enclosing common-dir ${path.join(enclosing, '.git')}, got: ${out}`,
          );
          const after = snapshot(enclosing);
          assert.deepEqual(after, before, 'expected the enclosing repository left untouched by the refused proof');
          return true;
        } finally {
          fs.rmSync(work, { recursive: true, force: true });
        }
      }),
      { numRuns: RUNS },
    );
  }

  assertReachFloor(reach, SHAPES, RUNS, 'fixture-root shape');
});
