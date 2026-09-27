'use strict';

// BL-1771: step handlers for "Stryker's initial test run passes on this
// host". Scenario 01 diffs the two REAL vitest configs' own test.exclude
// arrays - no vitest collection needed, since both configs share the same
// unset `include` (vitest.config.mjs's own comment: an explicit include is
// mangled to [] by the Stryker vitest-runner), so the exclude arrays alone
// say which file set each config selects. Scenario 02 proves the fix
// (bl1418RoleEnumerationClassification.test.js's own extension-root-relative
// resolution) inside a REAL Stryker-shaped sandbox, built under mkdtemp
// OUTSIDE the repository (BL-1761's own pattern) - nothing above the
// sandbox is a checkout, so a repair that escaped to the real checkout
// (git rev-parse --show-toplevel, an absolute repo path) could not pass.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('../../../extension/test/helpers/tmpDir');

const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const REPO_DIR = path.join(EXTENSION_DIR, '..');
const FEATURE = "BL-1771 Stryker's initial test run passes on this host";
const EXCLUDED_FILE_EXTENSION_RELATIVE = 'test/activePoolFreshnessAudit.test.js';

// The six extension/-prefixed sources bl1418RoleEnumerationClassification.test.js
// reads (its own SWARM-ROLES/CHAIN list checks) - kept in one place so
// scenario 02's fixture and any future maintenance name the same six files
// bl1418's own test file names.
const BL1418_SOURCE_FILES = [
  'src/concierge/roleTopicMapStore.ts',
  'src/concierge/topicIcon.ts',
  'src/swarm/rolePack.ts',
  'src/metrics/swarmMetrics.ts',
  'src/quality/qaBounce.ts',
  'src/benchmark/pipelineReviewOracle.ts',
];

function symlink(target, linkPath) {
  fs.symlinkSync(target, linkPath, fs.statSync(target).isDirectory() ? 'dir' : 'file');
}

async function loadConfigModule(fileName) {
  const mod = await import(path.join(EXTENSION_DIR, fileName));
  return mod.default;
}

function runVitestInSandbox(sandboxRoot, testDir, baseName) {
  const vitestBin = path.join(sandboxRoot, 'node_modules', '.bin', 'vitest');
  try {
    const out = execFileSync(vitestBin, ['run', '--dir', testDir, baseName, '--reporter=json'], {
      cwd: sandboxRoot,
      encoding: 'utf8',
      timeout: 60000,
    });
    return { status: 0, json: JSON.parse(out) };
  } catch (err) {
    // A failing vitest run exits non-zero; stdout still carries the JSON
    // report (the actual failure, never a bare crash with no report, is
    // what the Then step below needs to read).
    const out = err.stdout ? err.stdout.toString() : '';
    let json = null;
    try {
      json = JSON.parse(out);
    } catch {
      /* fall through with json: null - the Then step decides what that means */
    }
    return { status: err.status, json, message: err.message };
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01: the default Stryker run leaves out only the ruled file ─

  scoped(/^the vitest configuration the default Stryker run uses$/, async (ctx) => {
    const strykerConfigFile = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'stryker.config.json'), 'utf8')).vitest.configFile;
    ctx.strykerConfig = await loadConfigModule(strykerConfigFile);
  });

  scoped(/^the vitest configuration the unit lane uses$/, async (ctx) => {
    ctx.unitConfig = await loadConfigModule('vitest.config.mjs');
  });

  scoped(/^their test file selections are compared$/, (ctx) => {
    // Both configs share vitest's own default `include` (an explicit one
    // is mangled to [] by the Stryker vitest-runner, per vitest.config.mjs's
    // own comment - asserted here as a precondition), so the file SET each
    // config selects differs by exactly their `exclude` arrays' own
    // difference. Diffing those two arrays IS the file-selection
    // comparison, without needing a real vitest collection.
    assert.equal(ctx.strykerConfig.test.include, undefined, "the Stryker config must not set an explicit include (mangled to [] by Stryker's vitest-runner)");
    assert.equal(ctx.unitConfig.test.include, undefined, 'the unit lane config must not set an explicit include either, or the two configs would not share one selection base');
    const unitExclude = ctx.unitConfig.test.exclude;
    const strykerExclude = ctx.strykerConfig.test.exclude;
    ctx.addedExclusions = strykerExclude.filter((p) => !unitExclude.includes(p));
    ctx.droppedExclusions = unitExclude.filter((p) => !strykerExclude.includes(p));
  });

  scoped(/^the Stryker run leaves out extension\/test\/activePoolFreshnessAudit\.test\.js$/, (ctx) => {
    assert.ok(
      ctx.addedExclusions.includes(EXCLUDED_FILE_EXTENSION_RELATIVE),
      `expected the Stryker config to add an exclusion for ${EXCLUDED_FILE_EXTENSION_RELATIVE}, got: ${JSON.stringify(ctx.addedExclusions)}`
    );
    assert.ok(fs.existsSync(path.join(EXTENSION_DIR, 'test', 'activePoolFreshnessAudit.test.js')), 'the excluded file must actually exist - a dead pattern proves nothing');
  });

  scoped(/^it leaves out no other file the unit lane selects$/, (ctx) => {
    assert.deepEqual(
      ctx.addedExclusions,
      [EXCLUDED_FILE_EXTENSION_RELATIVE],
      `expected no exclusion beyond ${EXCLUDED_FILE_EXTENSION_RELATIVE}, got: ${JSON.stringify(ctx.addedExclusions)}`
    );
    assert.deepEqual(ctx.droppedExclusions, [], "the Stryker config must also keep every one of the unit lane's own exclusions - never select a file the unit lane itself excludes");
  });

  // ── Scenario 02: bl1418 passes from a Stryker-shaped sandbox ───────────

  scoped(/^a Stryker-shaped sandbox outside the repository whose directory is the extension root and whose parent links the repo-root siblings$/, (ctx) => {
    // outerParent stands in for .stryker-tmp/ - a freshly minted temp dir
    // is guaranteed to have no "extension" child of its own (BL-1066's own
    // rule: the sandbox dir IS the extension root, never a child of one).
    const outerParent = mkTmpDir('bl1771-sandbox-parent-');
    const sandboxRoot = path.join(outerParent, 'sandbox-root');
    fs.mkdirSync(path.join(sandboxRoot, 'test'), { recursive: true });
    // Copied, never symlinked, so its own __dirname resolves to the
    // fixture itself (BL-1761's own rule for the same reason).
    fs.copyFileSync(
      path.join(EXTENSION_DIR, 'test', 'bl1418RoleEnumerationClassification.test.js'),
      path.join(sandboxRoot, 'test', 'bl1418RoleEnumerationClassification.test.js')
    );
    for (const rel of BL1418_SOURCE_FILES) {
      const dest = path.join(sandboxRoot, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      symlink(path.join(EXTENSION_DIR, rel), dest);
    }
    symlink(path.join(EXTENSION_DIR, 'node_modules'), path.join(sandboxRoot, 'node_modules'));
    symlink(path.join(EXTENSION_DIR, 'vitest.config.mjs'), path.join(sandboxRoot, 'vitest.config.mjs'));
    // Vite resolves test.setupFiles against its OWN root (process.cwd()
    // here, never the dereferenced real path of a symlinked config file),
    // so the four setup files vitest.config.mjs lists must exist under
    // this same sandbox too, or the run fails before any test in the file
    // gets a chance to run at all (measured: "Cannot find module
    // .../test/helpers/tmpDirSetup.js" with this symlink absent).
    symlink(path.join(EXTENSION_DIR, 'test', 'helpers'), path.join(sandboxRoot, 'test', 'helpers'));
    // The repo-root-sibling case this file's own reads reach into (the
    // three swarmforge/scripts/*.bb reads): resolves against the
    // sandbox's OWN parent, standing in for .stryker-tmp/'s own parent
    // (the real checkout root) one level above the extension root - the
    // same sibling relationship a real Stryker run's
    // ensureStrykerSandboxSiblingLinks plants (extension/scripts/ensureStrykerSandboxSiblings.js's
    // own SIBLING_NAMES list). Only "swarmforge" is linked here because it
    // is the only sibling this ticket's own fix reaches into; a future
    // sibling this file starts reading would need its own added link.
    symlink(path.join(REPO_DIR, 'swarmforge'), path.join(outerParent, 'swarmforge'));
    ctx.__disposables = ctx.__disposables || [];
    ctx.__disposables.push(() => fs.rmSync(outerParent, { recursive: true, force: true }));
    ctx.sandboxRoot = sandboxRoot;
  });

  scoped(/^bl1418RoleEnumerationClassification\.test\.js runs inside that sandbox$/, (ctx) => {
    ctx.runResult = runVitestInSandbox(ctx.sandboxRoot, path.join(ctx.sandboxRoot, 'test'), 'bl1418RoleEnumerationClassification.test.js');
  });

  scoped(/^every test in it passes$/, (ctx) => {
    const { status, json, message } = ctx.runResult;
    if (status !== 0 || !json || json.success !== true || json.numFailedTests !== 0) {
      throw new Error(`expected a clean pass, got status=${status}, message=${message}, json=${JSON.stringify(json)}`);
    }
    assert.ok(json.numPassedTests > 0, 'expected at least one passed test');
  });
}

module.exports = { registerSteps };
