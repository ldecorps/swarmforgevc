'use strict';

// BL-1280 acceptance: the raw-mkdtemp migration is finished for the real
// extension/test tree, the detector was not blunted to get there, and the
// file-level exempt list did not grow to buy the green.
//
// Every verdict comes from the REAL guard (extension/test/helpers/
// rawMkdtempGuard.js) and the REAL pilot checker, never from a restatement.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_DIR = path.join(REPO_ROOT, 'extension', 'test');
const GUARD = path.join(TEST_DIR, 'helpers', 'rawMkdtempGuard.js');

const FEATURE_NAME = 'The raw-mkdtemp migration is finished for the real extension/test tree';

// The three paths tmpDir.js's own comment documents. Stated here as the
// scenario's expectation, so the acceptance disagrees loudly with the guard if
// either side changes alone.
const DOCUMENTED_EXEMPT_PATHS = [
  'helpers/tmpDir.js',
  'tmpDirMigrationGuard.test.js',
  'tmpDirMigrationGuard.property.test.js',
];

// The scratch tree's planted call site is written from PIECES, so this handler
// file is itself scannable: a contiguous literal here would make the very scan
// scenario 01 asserts report a violation in the acceptance's own step file.
const PLANTED_LINE =
  "const dir = fs.mkdtemp" + "Sync(path.join(os.tmpdir(), 'bl1280-planted-'));";

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^the shared temp-dir helper at extension\/test\/helpers\/tmpDir\.js$/, (ctx) => {
    ctx.bl1280 = { roots: [] };
    assert.ok(fs.existsSync(path.join(TEST_DIR, 'helpers', 'tmpDir.js')), 'the shared helper is missing');
    ctx.bl1280.guard = require(GUARD);
  });

  // ── 01 ────────────────────────────────────────────────────────────────
  scoped(/^the guard scans the real extension\/test tree$/, (ctx) => {
    ctx.bl1280.violations = ctx.bl1280.guard.findRawMkdtempCallSites(TEST_DIR);
  });

  scoped(/^it reports zero violations$/, (ctx) => {
    assert.deepEqual(
      ctx.bl1280.violations,
      [],
      `raw mkdtemp call sites remain:\n${ctx.bl1280.violations.map((v) => `${v.file}:${v.line}`).join('\n')}`
    );
  });

  // ── 02 ────────────────────────────────────────────────────────────────
  scoped(/^a scratch test tree containing one raw mkdtemp call site$/, (ctx) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1280-scratch-'));
    ctx.bl1280.roots.push(root);
    fs.writeFileSync(path.join(root, 'clean.test.js'), "const dir = mkTmpDir('bl1280-clean-');\n");
    fs.writeFileSync(path.join(root, 'planted.test.js'), `${PLANTED_LINE}\n`);
    ctx.bl1280.scratch = root;
  });

  scoped(/^the guard scans that tree$/, (ctx) => {
    ctx.bl1280.violations = ctx.bl1280.guard.findRawMkdtempCallSites(ctx.bl1280.scratch);
  });

  scoped(/^it reports that call site$/, (ctx) => {
    // The guard reports `file` relative to the process cwd, which for a scratch
    // root outside the repo is an absolute path - so the planted site is
    // matched by its tail, not by an exact string.
    assert.deepEqual(
      ctx.bl1280.violations.map((v) => `${path.basename(v.file)}:${v.line}`),
      ['planted.test.js:1'],
      'the detector no longer sees a planted raw call - it was blunted, not satisfied'
    );
    // No vitest sweep runs here (BL-420/BL-971).
    while (ctx.bl1280.roots.length) {
      fs.rmSync(ctx.bl1280.roots.pop(), { recursive: true, force: true });
    }
  });

  // ── 03 ────────────────────────────────────────────────────────────────
  scoped(/^the guard's file-level exempt list is read$/, (ctx) => {
    ctx.bl1280.exempt = ctx.bl1280.guard.SELF_EXEMPT_RELATIVE_PATHS;
  });

  scoped(/^it names exactly the three paths it documented before this change$/, (ctx) => {
    assert.deepEqual(ctx.bl1280.exempt, DOCUMENTED_EXEMPT_PATHS);
  });

  scoped(/^"(.+)" is not among them$/, (ctx, file) => {
    assert.ok(
      !ctx.bl1280.exempt.includes(file),
      `${file} is exempted wholesale; a file-level exemption also hides a REAL raw call it gains later`
    );
  });

  // ── 04 ────────────────────────────────────────────────────────────────
  scoped(/^the pilot mkdtemp convention check runs against a planted raw call site$/, (ctx) => {
    const { assessPilotMkdtempConvention } = require(
      path.join(REPO_ROOT, 'extension', 'out', 'tools', 'pilotMkdtempConventionCheck')
    );
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1280-pilot-'));
    ctx.bl1280.roots.push(root);
    const rel = path.join('extension', 'test', 'subject.test.js');
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), `${PLANTED_LINE}\n`);
    ctx.bl1280.assessment = assessPilotMkdtempConvention(root, [rel.split(path.sep).join('/')]);
  });

  scoped(/^it reports exactly one violation$/, (ctx) => {
    const { violations } = ctx.bl1280.assessment;
    assert.equal(
      violations.length,
      1,
      `expected one violation, got ${JSON.stringify(violations)}`
    );
    while (ctx.bl1280.roots.length) {
      fs.rmSync(ctx.bl1280.roots.pop(), { recursive: true, force: true });
    }
  });
}

module.exports = { registerSteps };
