'use strict';

// BL-374: run_gherkin_mutation.sh absolutized FEATURE_FILE and STEPS_MODULE
// against the caller's cwd but not WORK_DIR, then `cd`'d into the vendored
// tool directory (swarmforge/vendor/aps/, git-tracked and NOT gitignored)
// before exec'ing bb - so a relative work-dir named two different
// directories: `mkdir -p` created it under the caller's cwd (left empty),
// while the tool resolved the SAME relative string against the vendor
// dir instead, leaving a stray untracked diff there for a human to find
// and clean up by hand. Drives the REAL script and the REAL vendored
// gherkin-mutator against the same tiny fixture gherkinMutation.test.js
// (BL-113) already uses, from a controlled caller cwd - proves the actual
// property (which directory receives the scratch), never a reimplemented
// stand-in for the vendored tool.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'run_gherkin_mutation.sh');
const FIXTURE_FEATURE = path.join(__dirname, 'fixtures', 'mutation-wiring.feature');
const STEPS_MODULE = path.join(__dirname, 'fixtures', 'mutationWiringSteps.js');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const VENDOR_DIR = path.join(REPO_ROOT, 'swarmforge', 'vendor', 'aps');

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mutation-workdir-fixture-'));
  const featurePath = path.join(dir, 'mutation-wiring.feature');
  fs.copyFileSync(FIXTURE_FEATURE, featurePath);
  return featurePath;
}

function vendorDirGitStatus() {
  return execFileSync('git', ['-C', REPO_ROOT, 'status', '--porcelain', '--', 'swarmforge/vendor/aps'], { encoding: 'utf8' });
}

// Every test below that names a relative work-dir under ./tmp/... would,
// against the PRE-FIX script, land its scratch in this exact vendor path -
// so without this, an earlier test's own pollution (run in the same
// process) can make a LATER test's before/after vendor-status comparison
// falsely equal (both snapshots already dirty), passing for the wrong
// reason regardless of whether the fix is present. Called before AND
// after any vendor-status-sensitive test so neither direction leaks.
function cleanVendorTmpPollution() {
  fs.rmSync(path.join(VENDOR_DIR, 'tmp'), { recursive: true, force: true });
}

test('BL-374 wrapper-resolves-paths-against-caller-01: a relative work-dir resolves beneath the caller\'s own cwd', () => {
  const featurePath = copyFixture();
  const callerCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mutation-caller-'));
  try {
    const result = spawnSync('bash', [SCRIPT, featurePath, './tmp/gm-relative', STEPS_MODULE, 'soft'], {
      cwd: callerCwd,
      encoding: 'utf8',
    });
    // gherkin-mutator exits non-zero whenever any mutant survives - this
    // fixture deliberately has one (BL-113's own design), so exit status
    // is not the signal to check here; a parseable report is.
    JSON.parse(result.stdout);
    const expected = path.join(callerCwd, 'tmp', 'gm-relative');
    assert.ok(fs.existsSync(expected), `expected the mutation scratch directory to exist at ${expected}, under the caller's own cwd`);
    assert.ok(fs.readdirSync(expected).length > 0, `expected ${expected} to actually contain mutation scratch, not sit empty`);
  } finally {
    fs.rmSync(path.dirname(featurePath), { recursive: true, force: true });
    fs.rmSync(callerCwd, { recursive: true, force: true });
    cleanVendorTmpPollution();
  }
});

test('BL-374 wrapper-resolves-paths-against-caller-01: an absolute work-dir is used exactly as named', () => {
  const featurePath = copyFixture();
  const absWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mutation-abs-workdir-'));
  try {
    const result = spawnSync('bash', [SCRIPT, featurePath, absWorkDir, STEPS_MODULE, 'soft'], { encoding: 'utf8' });
    JSON.parse(result.stdout);
    assert.ok(fs.readdirSync(absWorkDir).length > 0, `expected ${absWorkDir} to contain mutation scratch`);
  } finally {
    fs.rmSync(path.dirname(featurePath), { recursive: true, force: true });
    fs.rmSync(absWorkDir, { recursive: true, force: true });
  }
});

test('BL-374 wrapper-resolves-paths-against-caller-01: an omitted work-dir falls back to a fresh private temp directory, never the vendor dir', () => {
  cleanVendorTmpPollution();
  const featurePath = copyFixture();
  const before = vendorDirGitStatus();
  try {
    // Empty string for work-dir is bash's own "unset" shape for `${2:-}` -
    // matches omitting the argument while still supplying steps-module/level.
    const result = spawnSync('bash', [SCRIPT, featurePath, '', STEPS_MODULE, 'soft'], { encoding: 'utf8' });
    JSON.parse(result.stdout);
  } finally {
    fs.rmSync(path.dirname(featurePath), { recursive: true, force: true });
  }
  const after = vendorDirGitStatus();
  assert.equal(after, before, 'expected an omitted work-dir to never leave scratch under the vendored tool directory');
  cleanVendorTmpPollution();
});

test('BL-374 wrapper-resolves-paths-against-caller-02: a mutation run with a relative work-dir leaves the vendored tool directory clean', () => {
  cleanVendorTmpPollution();
  const featurePath = copyFixture();
  const callerCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mutation-caller-'));
  const before = vendorDirGitStatus();
  try {
    const result = spawnSync('bash', [SCRIPT, featurePath, './tmp/gm-clean-check', STEPS_MODULE, 'soft'], {
      cwd: callerCwd,
      encoding: 'utf8',
    });
    JSON.parse(result.stdout);
  } finally {
    fs.rmSync(path.dirname(featurePath), { recursive: true, force: true });
    fs.rmSync(callerCwd, { recursive: true, force: true });
  }
  const after = vendorDirGitStatus();
  assert.equal(after, before, `expected no new files under swarmforge/vendor/aps after a relative-work-dir run; before=[${before}] after=[${after}]`);
  cleanVendorTmpPollution();
});
