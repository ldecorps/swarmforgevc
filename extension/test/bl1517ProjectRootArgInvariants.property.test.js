'use strict';

// BL-1517's three declared invariants (coder first authorship, BL-654):
// 1. "No CLI wired to the check creates a directory, file or log under a
//    root argument that failed the check; the refusal happens before the
//    first write and names the offending argument verbatim."
// 2. "No harness under swarmforge/scripts/test/ ever resolves its fixture
//    root relative to the process working directory: an absent root is
//    refused, never defaulted."
// 3. "A refused invocation is inert - it reads no mailbox, writes no
//    state, and sends no handoff, so the filesystem is byte-identical
//    before and after it."
//
// Encoded against the REAL wired scripts as fresh `bb` child processes -
// never a reimplementation of project_root_arg_lib.bb's own check.
//
// Generator reach: property one draws (site, bad-arg) pairs across the
// SIX real wiring sites (three CLIs, three harnesses) crossed with TWO
// bad-arg shapes (flag-shaped, not-a-directory) - 12 combinations, well
// within the generator's reach, and the assertions below prove every
// site and both shapes were actually drawn, not merely offered. Property
// two draws across the three harnesses invoked with NO argument at all -
// the absent-root path a flag-shaped or not-a-directory arg cannot
// reach, since "absent" is a different branch through check-root
// (:blank) than "present but invalid".
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const TEST_SCRIPTS_DIR = path.join(SCRIPTS_DIR, 'test');

function mkScratchDir(prefix) {
  return fs.realpathSync(mkTmpDir(prefix));
}

function snapshot(dir) {
  return fs.readdirSync(dir).sort();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Each site's own invocation shape: given a bad root-position argument,
// the argv this property should pass. expedite_cli.bb's unpark takes the
// root as its SECOND token (after the literal "unpark").
const SITES = [
  { name: 'main_sync_status_cli.bb', file: path.join(SCRIPTS_DIR, 'main_sync_status_cli.bb'), argsFor: (arg) => [arg], isHarness: false },
  { name: 'operator_runtime.bb', file: path.join(SCRIPTS_DIR, 'operator_runtime.bb'), argsFor: (arg) => [arg], isHarness: false },
  { name: 'expedite_cli.bb', file: path.join(SCRIPTS_DIR, 'expedite_cli.bb'), argsFor: (arg) => ['unpark', arg, 'run-dir'], isHarness: false },
  { name: 'dispatch_gap_sweep_harness.bb', file: path.join(TEST_SCRIPTS_DIR, 'dispatch_gap_sweep_harness.bb'), argsFor: (arg) => [arg], isHarness: true },
  { name: 'dropped_parcel_sweep_harness.bb', file: path.join(TEST_SCRIPTS_DIR, 'dropped_parcel_sweep_harness.bb'), argsFor: (arg) => [arg], isHarness: true },
  { name: 'commit_integrity_856_scenarios_cli.bb', file: path.join(TEST_SCRIPTS_DIR, 'commit_integrity_856_scenarios_cli.bb'), argsFor: (arg) => [arg], isHarness: true },
];

const siteArbitrary = fc.constantFrom(...SITES);

const badArgArbitrary = fc.oneof(
  fc.constantFrom('--help', '--tick-once', '-x', '--unknown-flag').map((arg) => ({ shape: 'flagShaped', arg })),
  fc
    .string({ minLength: 1, maxLength: 12 })
    .filter((s) => /^[a-zA-Z0-9_-]+$/.test(s))
    .map((s) => ({ shape: 'notADirectory', arg: `bl1517-nonexistent-${s}` }))
);

test(
  'property (BL-1517 invariants 1 & 3): every wired site refuses a bad root-position argument, names it verbatim, and leaves the scratch cwd byte-identical',
  () => {
    let draws = 0;
    const seenSites = new Set();
    const seenShapes = new Set();
    fc.assert(
      fc.property(siteArbitrary, badArgArbitrary, fc.integer({ min: 0, max: 999999 }), (site, badArg, salt) => {
        draws += 1;
        seenSites.add(site.name);
        seenShapes.add(badArg.shape);
        const scratch = mkScratchDir(`bl1517-prop-${salt}-`);
        try {
          const before = snapshot(scratch);
          const result = spawnSync('bb', [site.file, ...site.argsFor(badArg.arg)], { cwd: scratch, encoding: 'utf8' });
          const after = snapshot(scratch);
          assert.notEqual(result.status, 0, `${site.name}(${badArg.shape}=${badArg.arg}): expected a non-zero exit, got 0`);
          assert.match(
            result.stderr,
            new RegExp(`REFUSED project-root ${escapeRegExp(badArg.arg)}:`),
            `${site.name}(${badArg.shape}=${badArg.arg}): expected a REFUSED project-root line naming the arg verbatim, got: ${result.stderr}`
          );
          assert.deepEqual(
            after,
            before,
            `${site.name}(${badArg.shape}=${badArg.arg}): expected no new entry in the scratch cwd, before: ${JSON.stringify(before)}, after: ${JSON.stringify(after)}`
          );
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      }),
      { numRuns: 30 }
    );
    assert.equal(seenSites.size, SITES.length, `expected the generator to reach every site, reached: ${JSON.stringify([...seenSites])}`);
    assert.equal(seenShapes.size, 2, `expected the generator to reach both bad-arg shapes, reached: ${JSON.stringify([...seenShapes])}`);
    assert.ok(draws >= 20);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

const HARNESSES = SITES.filter((s) => s.isHarness);

test(
  'property (BL-1517 invariant 2): every harness invoked with NO argument refuses instead of defaulting to the process cwd, over repeated independent draws',
  () => {
    let draws = 0;
    const seen = new Set();
    fc.assert(
      fc.property(fc.constantFrom(...HARNESSES), fc.integer({ min: 0, max: 999999 }), (harness, salt) => {
        draws += 1;
        seen.add(harness.name);
        const scratch = mkScratchDir(`bl1517-noarg-${salt}-`);
        try {
          const result = spawnSync('bb', [harness.file], { cwd: scratch, encoding: 'utf8' });
          assert.notEqual(result.status, 0, `${harness.name}: expected a non-zero exit on a bare invocation`);
          assert.match(result.stderr, /REFUSED project-root/, `${harness.name}: expected a REFUSED line, got: ${result.stderr}`);
          assert.equal(
            fs.existsSync(path.join(scratch, '.swarmforge')),
            false,
            `${harness.name}: expected no .swarmforge created under the scratch cwd`
          );
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      }),
      { numRuns: 15 }
    );
    assert.equal(seen.size, HARNESSES.length, `expected the generator to reach all three harnesses, reached: ${JSON.stringify([...seen])}`);
    assert.ok(draws >= 9);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test('property (BL-1517 invariants) non-vacuity: the same probe WOULD catch the pre-fix (unguarded) shape - proven against a scratch fixture reproducing the real bug, never the real tree', () => {
  const scratchDir = mkScratchDir('bl1517-non-vacuity-');
  const scratchHarness = path.join(scratchDir, 'zzzPreFixUnguardedSteps.bb');
  fs.writeFileSync(
    scratchHarness,
    "#!/usr/bin/env bb\n(require '[babashka.fs :as fs])\n(def project-root (first *command-line-args*))\n(fs/create-dirs (fs/path project-root \".swarmforge\" \"probe\"))\n(println \"ran\")\n"
  );
  const cwd = mkScratchDir('bl1517-non-vacuity-cwd-');
  try {
    const result = spawnSync('bb', [scratchHarness, '--flag-looking-root'], { cwd, encoding: 'utf8' });
    // The PRE-FIX shape: no refusal (exit 0), and a real directory shows
    // up under the flag-shaped argument, created relative to cwd - this
    // is the exact BL-889/BL-1517 hazard the fix closes, proven here so
    // the properties above are not vacuously true.
    assert.equal(result.status, 0, 'expected the unguarded fixture to exit 0 (no refusal) - the pre-fix shape');
    assert.equal(
      fs.existsSync(path.join(cwd, '--flag-looking-root', '.swarmforge')),
      true,
      'expected the unguarded fixture to actually create a directory under the flag-shaped argument, proving the properties above are non-vacuous'
    );
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
