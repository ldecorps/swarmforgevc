'use strict';

// BL-1867: `extension/test/helpers/sharedRepoFixture.js` (BL-1039) had two
// defects. `templateIsHealthy` treated `git config core.worktree`'s exit 1
// (the key simply unset - the common, healthy case) as a thrown failure, so
// every copy re-seeded a fresh template and zeroed the seed counter, and a
// vitest fork worker torn down by the pool never fired
// `mkProcessTmpDir`'s own `process.once('exit')` cleanup, so /tmp gained
// about 40,000 `bl1039-seed-template-*` dirs a day (445,231 of them on
// 2026-10-01).
//
// Scenarios 01/02 drive real child `node` processes (a plain process exits
// normally, so its OWN template cleans itself up on exit - never the
// defect this ticket fixes) with TMPDIR pointed at an isolated root, and
// assert from inside the child BEFORE it exits, since the count would
// otherwise read back empty after its own legitimate exit-time cleanup
// already ran.
//
// Scenario 03 drives a REAL `vitest run` of a real unit-lane file known to
// use the fixture (test/applyCooldownPauseCli.test.js), with the SAME
// isolated TMPDIR, and inspects what is left behind only AFTER that real
// run has fully exited - the actual leak this ticket closes.
//
// Fixture roots come from mkProcessTmpDir (BL-1636 fixture-reaping
// convention): the acceptance runner has no Vitest afterEach.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = 'BL-1867 a vitest run leaves no seed template behind';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const SHARED_REPO_FIXTURE_PATH = path.join(EXTENSION_DIR, 'test', 'helpers', 'sharedRepoFixture.js');

function runChild(script, tmpdir) {
  const scriptPath = path.join(tmpdir, `probe-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(scriptPath, script);
  const out = execFileSync('node', [scriptPath], {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: tmpdir },
  });
  fs.rmSync(scriptPath, { force: true });
  return JSON.parse(out.trim().split('\n').pop());
}

function gitLog(dir) {
  return execFileSync('git', ['-C', dir, 'log', '--format=%s'], { encoding: 'utf8' }).trim();
}

function ensureState(ctx) {
  if (!ctx.bl1867) ctx.bl1867 = { tmpdir: mkProcessTmpDir('bl1867acc-tmpdir-') };
  return ctx.bl1867;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^an empty temp directory set as TMPDIR$/, (ctx) => {
    ensureState(ctx);
  });

  // ── 01: 5 copies in one process seed exactly 1 template ──────────────────
  scoped(/^the process copies the seeded repository into 5 directories$/, (ctx) => {
    const state = ensureState(ctx);
    const script = `
'use strict';
const fs = require('fs');
const os = require('os');
const { checkoutSeededRepo, resetForTest } = require(${JSON.stringify(SHARED_REPO_FIXTURE_PATH)});
resetForTest();
const dirs = [];
for (let i = 0; i < 5; i += 1) dirs.push(checkoutSeededRepo(\`bl1867-copy-\${i}-\`));
const templateCount = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('bl1039-seed-template-')).length;
process.stdout.write(JSON.stringify({ templateCount, copies: dirs }));
`;
    state.scenario01 = runChild(script, state.tmpdir);
  });

  scoped(/^exactly 1 seed template is in the temp directory before the process exits$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(
      state.scenario01.templateCount,
      1,
      `expected exactly 1 seed template, got ${state.scenario01.templateCount}`
    );
  });

  // ── 02: a genuine re-seed after the template is found unhealthy counts cumulatively ─
  scoped(/^the process copies the seeded repository once, sets core\.worktree in the template, and copies it again$/, (ctx) => {
    const state = ensureState(ctx);
    const script = `
'use strict';
const { execFileSync } = require('child_process');
const { checkoutSeededRepo, seedTemplateOnce, seedCount, resetForTest } = require(${JSON.stringify(SHARED_REPO_FIXTURE_PATH)});
resetForTest();
const a = checkoutSeededRepo('bl1867-copy2a-');
const template = seedTemplateOnce();
execFileSync('git', ['config', 'core.worktree', '/nonexistent-bl1867-path'], { cwd: template });
const b = checkoutSeededRepo('bl1867-copy2b-');
process.stdout.write(JSON.stringify({ seedCount: seedCount(), copies: [a, b] }));
`;
    state.scenario02 = runChild(script, state.tmpdir);
  });

  scoped(/^the helper's seed count is 2$/, (ctx) => {
    const state = ensureState(ctx);
    assert.equal(state.scenario02.seedCount, 2, `expected seedCount() to report 2, got ${state.scenario02.seedCount}`);
  });

  // Shared "every copy is a git repository..." assertion for whichever of
  // scenario 01/02 just ran (the last one whose `copies` this state holds).
  scoped(/^every copy is a git repository with exactly one commit on main$/, (ctx) => {
    const state = ensureState(ctx);
    const copies = (state.scenario02 || state.scenario01).copies;
    assert.ok(copies.length > 0, 'expected at least one copy to check');
    for (const dir of copies) {
      assert.ok(fs.existsSync(path.join(dir, '.git')), `${dir}: expected a real git repository`);
      assert.equal(gitLog(dir), 'init', `${dir}: expected exactly the seeded "init" commit`);
      const branch = execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
      assert.equal(branch, 'main', `${dir}: expected the seeded repository to be on main`);
    }
  });

  // ── 03: a real vitest run leaves no template behind ───────────────────────
  scoped(/^"([^"]+)" still copies the seeded repository$/, (ctx, testFile) => {
    const state = ensureState(ctx);
    const text = fs.readFileSync(path.join(EXTENSION_DIR, testFile), 'utf8');
    assert.match(
      text,
      /checkoutSeededRepo|copySeededRepoInto/,
      `${testFile}: expected it to still use the shared-repo fixture (else this scenario would pass vacuously - BL-1445)`
    );
    state.testFile = testFile;
  });

  scoped(/^"([^"]+)" is run alone with the unit vitest config$/, (ctx, testFile) => {
    const state = ensureState(ctx);
    assert.equal(state.testFile, testFile);
    state.runOutput = execFileSync('npx', ['vitest', 'run', '--config', 'vitest.config.mjs', testFile], {
      cwd: EXTENSION_DIR,
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: state.tmpdir },
    });
  });

  scoped(/^the run passes$/, (ctx) => {
    const state = ensureState(ctx);
    assert.match(state.runOutput, /passed/i, `expected the run to report a pass, got: ${state.runOutput}`);
  });

  scoped(/^the temp directory holds no entry whose name starts with "([^"]+)"$/, (ctx, prefix) => {
    const state = ensureState(ctx);
    const leftover = fs.readdirSync(state.tmpdir).filter((n) => n.startsWith(prefix));
    assert.deepEqual(leftover, [], `expected no "${prefix}" entries left in TMPDIR, got: ${JSON.stringify(leftover)}`);
  });
}

module.exports = { registerSteps };
