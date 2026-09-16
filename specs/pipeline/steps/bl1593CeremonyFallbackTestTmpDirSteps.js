'use strict';

// BL-1593: step handlers for "the hotfix-landed ceremony fallback test
// builds its fixture through the shared helpers". Drives the REAL
// detectors (extension/test/helpers/rawMkdtempGuard.js,
// liveRepoDerivationGuard.js) and the REAL fallback test file - never a
// restated regex or a reimplementation of either guard.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1593 The hotfix-landed ceremony fallback test builds its fixture through the shared helpers';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const TEST_DIR = path.join(EXTENSION_DIR, 'test');
const FALLBACK_FILE_REL = 'test/nightClosingCeremonyRotateDocumenterFallback.test.js';
const FALLBACK_FILE_ABS = path.join(EXTENSION_DIR, FALLBACK_FILE_REL);

const { findRawMkdtempCallSites } = require(path.join(TEST_DIR, 'helpers', 'rawMkdtempGuard'));
const { findLiveRepoDerivations } = require(path.join(TEST_DIR, 'helpers', 'liveRepoDerivationGuard'));

const TARGET_TO_KIND = {
  'extension/test/nightClosingCeremonyRotateDocumenterFallback.test.js': 'file',
  'the whole extension test tree': 'tree',
};

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Scenario 01: the raw mkdtemp guard finds no call site ────────────────
  scoped(/^the raw mkdtemp guard scans (.+)$/, (ctx, target) => {
    const kind = TARGET_TO_KIND[target];
    assert.ok(kind, `unknown target example value: "${target}"`);
    const violations = findRawMkdtempCallSites(TEST_DIR);
    ctx.bl1593rawMkdtempViolations =
      kind === 'file' ? violations.filter((v) => path.resolve(v.file) === path.resolve(FALLBACK_FILE_ABS)) : violations;
  });

  scoped(/^it reports no raw call site$/, (ctx) => {
    assert.deepEqual(ctx.bl1593rawMkdtempViolations, [], `expected no raw mkdtemp call sites, found: ${JSON.stringify(ctx.bl1593rawMkdtempViolations)}`);
  });

  // ── Scenario 02: mkTmpDir allocated exactly once ─────────────────────────
  scoped(/^the source of extension\/test\/nightClosingCeremonyRotateDocumenterFallback\.test\.js is read$/, (ctx) => {
    ctx.bl1593source = fs.readFileSync(FALLBACK_FILE_ABS, 'utf8');
  });

  scoped(/^it allocates its fixture root through mkTmpDir exactly once$/, (ctx) => {
    const matches = ctx.bl1593source.match(/\bmkTmpDir\(/g) || [];
    assert.equal(matches.length, 1, `expected exactly one mkTmpDir(...) call, found ${matches.length}:\n${ctx.bl1593source}`);
  });

  // ── Scenario 03: the live-repo derivation guard finds no violation ───────
  scoped(/^the live-repo derivation guard scans the whole extension test tree$/, (ctx) => {
    ctx.bl1593liveRepoViolations = findLiveRepoDerivations(TEST_DIR);
  });

  scoped(/^it reports no violation$/, (ctx) => {
    assert.deepEqual(ctx.bl1593liveRepoViolations, [], `expected no live-repo derivation violations, found: ${JSON.stringify(ctx.bl1593liveRepoViolations)}`);
  });

  scoped(/^the fallback test carries no BL-1038 exemption marker$/, (ctx) => {
    const source = ctx.bl1593source || fs.readFileSync(FALLBACK_FILE_ABS, 'utf8');
    assert.ok(!/BL-1038-EXEMPT/.test(source), 'the fallback test carries a BL-1038-EXEMPT marker');
  });

  // ── Scenario 04: the fallback test still passes ──────────────────────────
  scoped(/^extension\/test\/nightClosingCeremonyRotateDocumenterFallback\.test\.js runs alone under the unit config$/, (ctx) => {
    const result = execFileSync('npx', ['vitest', 'run', FALLBACK_FILE_REL], {
      cwd: EXTENSION_DIR,
      encoding: 'utf8',
      timeout: 60000,
    });
    ctx.bl1593runOutput = result;
  });

  scoped(/^every test in it passes$/, (ctx) => {
    assert.match(ctx.bl1593runOutput, /3 passed/, `expected 3 passed, got:\n${ctx.bl1593runOutput.slice(-2000)}`);
  });
}

module.exports = { registerSteps };
