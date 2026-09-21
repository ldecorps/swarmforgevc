'use strict';

// BL-1516's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  No standing test, run from any checkout, creates or
//                removes a top-level entry of that checkout, a ref in its
//                repository, or a registered worktree of it; every
//                fixture root is proven (git rev-parse --git-common-dir
//                resolves under the fixture's mkdtemp) before the
//                fixture's first mutating git command, and a root that
//                fails the proof aborts the test naming the path.
//   invariant 2  A bb script loaded under a probe (load-file, not
//                invoked) never writes to a path derived from its
//                placeholder root; the placeholder is an absolute temp
//                directory or the write is refused - it is never a
//                relative name resolved against cwd.
//
// Drives the REAL test_bl1378_expedite_close_guard.sh's own prove_root
// (via specs/pipeline/steps/lib/bl1516FixtureRootProofCli.sh, which
// extracts the function by source position, never retypes it), the REAL
// run_bb_suite.sh (via .../bl1516RunBbSuiteCensusCli.sh, against an
// isolated fixture checkout, never the live repository - BL-1390), and the
// REAL handoffd.bb probe placeholder (via
// .../bl1516HandoffdProbePlaceholderCli.bb).
//
// GENERATOR REACH (reached by construction, never by draw). Invariant 1
// needs both prove_root's OWN two failure shapes reached (a path that is
// not a git repository at all, and a real repository whose path string
// merely sits outside $TMPROOT) plus its pass shape (a genuinely proven
// root) - a generator that only ever produced one bad shape would prove
// nothing about the other. It also needs the suite census exercised over
// varied entry names, including one shaped like a flag ("--x"), since a
// census that only ever saw ordinary names could hide a naive
// getopts-style parse. Invariant 2 needs the probe driven from several
// DIFFERENT isolated cwds, so "the log resolves outside cwd" is checked
// against more than one fixed location.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB_DIR = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'lib');
const ROOT_PROOF_CLI = path.join(LIB_DIR, 'bl1516FixtureRootProofCli.sh');
const SUITE_CENSUS_CLI = path.join(LIB_DIR, 'bl1516RunBbSuiteCensusCli.sh');
const HANDOFFD_PROBE_CLI = path.join(LIB_DIR, 'bl1516HandoffdProbePlaceholderCli.bb');

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function initRepo(root) {
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

// ── invariant 1 ────────────────────────────────────────────────────────

const BAD_ROOT_SHAPES = ['not-a-repo', 'repo-outside-tmproot'];
const ENTRY_SHAPES = ['plain-entry', '--flag-shaped-entry', 'entry.with.dots'];

test('BL-1516/BL-654 invariant 1a: prove_root refuses every bad-root shape before any mutating git command, and passes a genuinely proven one', () => {
  const shapes = [...BAD_ROOT_SHAPES, 'good-root'];
  const RUNS = runsPerCell(3 * shapes.length, shapes.length);
  const reach = Object.fromEntries(shapes.map((s) => [s, 0]));

  for (const shape of shapes) {
    fc.assert(
      fc.property(fc.constant(shape), () => {
        reach[shape] += 1;
        const work = mkTmpDir('bl1516-property-');
        const tmproot = path.join(work, 'tmproot');
        fs.mkdirSync(tmproot, { recursive: true });
        const enclosing = path.join(work, 'enclosing');
        initRepo(enclosing);
        const before = snapshot(enclosing);
        try {
          if (shape === 'good-root') {
            const result = spawnSync('bash', [ROOT_PROOF_CLI, 'good-root', tmproot], { encoding: 'utf8' });
            assert.equal(result.status, 0, `expected a clean exit, got ${result.status}: ${result.stderr}`);
            const fixtureRoot = result.stdout.trim();
            assert.ok(fixtureRoot.startsWith(tmproot), `expected the fixture under ${tmproot}, got: ${fixtureRoot}`);
            assert.ok(git(fixtureRoot, 'rev-parse', '--git-common-dir'), `expected a real repository at ${fixtureRoot}`);
          } else {
            const target = shape === 'not-a-repo'
              ? (() => { const d = path.join(work, 'plain-dir'); fs.mkdirSync(d, { recursive: true }); return d; })()
              : enclosing;
            const result = spawnSync('bash', [ROOT_PROOF_CLI, 'bad-root', tmproot, target], { encoding: 'utf8' });
            assert.notEqual(result.status, 0, `expected a refusal for shape ${shape}, got 0: ${result.stdout}`);
            const out = `${result.stdout}${result.stderr}`;
            assert.ok(out.includes(target), `expected the refusal to name ${target}, got: ${out}`);
          }
          const after = snapshot(enclosing);
          assert.deepEqual(after, before, `expected the enclosing repository untouched for shape ${shape}`);
          return true;
        } finally {
          fs.rmSync(work, { recursive: true, force: true });
        }
      }),
      { numRuns: RUNS },
    );
  }

  assertReachFloor(reach, shapes, RUNS, 'prove_root shape');
});

test('BL-1516/BL-654 invariant 1b: the suite runner\'s census names every entry a test creates, whatever its own shape, and blames nothing when there is none', () => {
  const shapes = [...ENTRY_SHAPES, 'CLEAN'];
  const RUNS = runsPerCell(3 * shapes.length, shapes.length);
  const reach = Object.fromEntries(shapes.map((s) => [s, 0]));

  for (const entry of shapes) {
    fc.assert(
      fc.property(fc.constant(entry), () => {
        reach[entry] += 1;
        const result = spawnSync('bash', [SUITE_CENSUS_CLI, `test_property_planted.sh=${entry}`], { encoding: 'utf8' });
        const out = `${result.stdout}${result.stderr}`;
        if (entry === 'CLEAN') {
          assert.equal(result.status, 0, `expected a clean exit for CLEAN, got ${result.status}: ${out}`);
          assert.doesNotMatch(out, /ROOT_POLLUTION_DETECTED/, `expected no pollution line for CLEAN, got:\n${out}`);
        } else {
          assert.notEqual(result.status, 0, `expected a non-zero exit for entry ${entry}, got 0: ${out}`);
          assert.ok(
            out.includes(`ROOT_POLLUTION_DETECTED test=test_property_planted.sh entry=${entry}`),
            `expected the pollution line naming ${entry}, got:\n${out}`,
          );
        }
        return true;
      }),
      { numRuns: RUNS },
    );
  }

  assertReachFloor(reach, shapes, RUNS, 'planted-entry shape');
});

// ── invariant 2 ────────────────────────────────────────────────────────

test('BL-1516/BL-654 invariant 2: the handoffd probe placeholder never writes under whatever cwd it is loaded from, and its own log path is always absolute', { timeout: 60000 }, () => {
  const cwdNames = ['plain-cwd', 'a cwd with spaces', 'nested/deep/cwd'];
  const RUNS = runsPerCell(3 * cwdNames.length, cwdNames.length);
  const reach = Object.fromEntries(cwdNames.map((c) => [c, 0]));

  for (const cwdName of cwdNames) {
    fc.assert(
      fc.property(fc.constant(cwdName), () => {
        reach[cwdName] += 1;
        const work = mkTmpDir('bl1516-probe-property-');
        const isolatedCwd = path.join(work, cwdName);
        fs.mkdirSync(isolatedCwd, { recursive: true });
        try {
          const result = spawnSync('bb', [HANDOFFD_PROBE_CLI, isolatedCwd], { encoding: 'utf8', cwd: isolatedCwd });
          assert.equal(result.status, 0, `expected exit 0 for cwd ${cwdName}, got ${result.status}: ${result.stdout}${result.stderr}`);
          const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
          assert.equal(parsed['probe-entry-exists-at-cwd?'], false, `expected no probe entry at ${isolatedCwd}, got: ${JSON.stringify(parsed)}`);
          assert.ok(path.isAbsolute(parsed['log-file']), `expected an absolute log path, got: ${parsed['log-file']}`);
          assert.ok(!parsed['log-file'].startsWith(isolatedCwd), `expected the log path outside ${isolatedCwd}, got: ${parsed['log-file']}`);
          const entries = fs.readdirSync(isolatedCwd);
          assert.deepEqual(entries, [], `expected ${isolatedCwd} to remain empty, got: ${JSON.stringify(entries)}`);
          return true;
        } finally {
          fs.rmSync(work, { recursive: true, force: true });
        }
      }),
      { numRuns: RUNS },
    );
  }

  assertReachFloor(reach, cwdNames, RUNS, 'isolated cwd shape');
});
