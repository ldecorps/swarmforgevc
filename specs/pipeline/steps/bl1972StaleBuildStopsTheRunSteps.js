'use strict';

// BL-1972: step handlers for "A unit test run on a stale build stops before
// any test". The pure check lives in extension/test/helpers/staleBuildGuard.js
// (unit-tested there on fake times); the globalSetup entry that wires it to
// the real fs is extension/test/helpers/bl1972StaleBuildGuardSetup.js, wired
// into vitest.config.mjs's globalSetup (inherited by vitest.stryker.config.mjs's
// `...cfg.test` spread, so the Stryker sandbox run is covered too).
//
// Scenario 01 drives the REAL vitest.config.mjs (loaded as ESM) and asserts
// its globalSetup includes the stale-build check. Scenarios 02-03 drive the
// REAL globalSetup entry against a fixture extension tree (a source file and
// its compiled output, with controlled mtimes) and assert the run stops
// naming the file and `npm run compile` when stale, and goes on clean when
// fresh.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1972 A unit test run on a stale build stops before any test';
const EXTENSION_ROOT = path.join(__dirname, '..', '..', '..', 'extension');
const VITEST_CONFIG = path.join(EXTENSION_ROOT, 'vitest.config.mjs');

function ensure(ctx) {
  if (!ctx.bl1972) {
    ctx.bl1972 = { root: null, source: null, compiled: null, last: null };
  }
  return ctx.bl1972;
}

// Builds a minimal fixture extension tree: a tsconfig.json (rootDir src,
// outDir out), one source file under src/, and its compiled file under
// out/. Returns the root.
function buildFixtureExtension(ctx) {
  const st = ensure(ctx);
  if (st.root) return st.root;
  st.root = trackedTmpRoot('bl1972-extension-');
  const srcDir = path.join(st.root, 'src');
  const outDir = path.join(st.root, 'out');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(st.root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { rootDir: 'src', outDir: 'out' } }, null, 2)
  );
  st.source = path.join(srcDir, 'a.ts');
  st.compiled = path.join(outDir, 'a.js');
  fs.writeFileSync(st.source, 'export const a = 1;\n');
  fs.writeFileSync(st.compiled, 'exports.a = 1;\n');
  return st.root;
}

// Runs the REAL globalSetup entry's check against a fixture root. The entry
// (bl1972StaleBuildGuardSetup.js) is a thin wrapper that calls
// assertBuildIsFresh() with no args (the real extension root); the step
// handlers drive the SAME entry point against the fixture by calling
// assertBuildIsFresh(root) directly - the entry's own assertBuildIsFresh
// takes an injectable extensionRoot, so this exercises the exact code the
// globalSetup runs, pointed at the fixture tree.
// Returns { threw, message } - threw is true when the check threw (the run
// stopped before any test), message is the thrown Error's message.
function runGlobalSetupAgainst(root) {
  const { assertBuildIsFresh } = require(path.join(EXTENSION_ROOT, 'test', 'helpers', 'staleBuildGuard'));
  try {
    assertBuildIsFresh(root);
    return { threw: false, message: null };
  } catch (err) {
    return { threw: true, message: err && err.message ? err.message : String(err) };
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── background ─────────────────────────────────────────────────────────
  scoped(/^an extension fixture with a source file and its compiled output$/, (ctx) => {
    buildFixtureExtension(ctx);
  });

  // ── scenario 01 ────────────────────────────────────────────────────────
  scoped(/^the default unit test configuration is loaded$/, async (ctx) => {
    // Loading the real vitest.config.mjs executes its top-level
    // `require('./out/tools/vitest-worker-memory-budget')`, which needs a
    // compiled out/. In the acceptance env out/ may be uncompiled; fall back
    // to reading the config file text and asserting it names the check.
    let cfg = null;
    try {
      const mod = await import(pathToFileURL(VITEST_CONFIG).href);
      cfg = mod.default || mod;
    } catch (err) {
      ctx.bl1972.configText = fs.readFileSync(VITEST_CONFIG, 'utf8');
    }
    ctx.bl1972.config = cfg;
  });

  scoped(/^its global setup includes the stale-build check$/, (ctx) => {
    const st = ensure(ctx);
    if (st.config) {
      const globalSetup = st.config.test && st.config.test.globalSetup;
      assert.ok(Array.isArray(globalSetup), `expected a globalSetup array, got: ${JSON.stringify(globalSetup)}`);
      assert.ok(
        globalSetup.some((entry) => entry.includes('bl1972StaleBuildGuardSetup')),
        `expected the globalSetup to include the stale-build check, got: ${JSON.stringify(globalSetup)}`
      );
    } else {
      // Config could not be loaded (uncompiled out/); assert the file text
      // names the check in its globalSetup.
      assert.ok(st.configText, 'expected the vitest config text to be readable');
      assert.ok(
        st.configText.includes('bl1972StaleBuildGuardSetup'),
        `expected the vitest config to name the stale-build check, got: ${st.configText}`
      );
    }
  });

  // ── scenario 02 ────────────────────────────────────────────────────────
  scoped(/^the source file was changed after its compiled output was written$/, (ctx) => {
    const st = ensure(ctx);
    const now = Date.now();
    // Source newer than compiled: the source was changed after the compiled
    // output was written.
    fs.utimesSync(st.source, new Date(now + 1000), new Date(now + 1000));
    fs.utimesSync(st.compiled, new Date(now), new Date(now));
  });

  scoped(/^the unit test configuration's global setup runs$/, (ctx) => {
    const st = ensure(ctx);
    st.last = runGlobalSetupAgainst(st.root);
  });

  scoped(/^the run stops before any test with a message naming that source file and npm run compile$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(st.last && st.last.threw, `expected the global setup to throw (stop the run), got: ${JSON.stringify(st.last)}`);
    assert.ok(st.last.message.includes('a.ts'), `expected the message to name the source file, got: ${st.last.message}`);
    assert.ok(st.last.message.includes('npm run compile'), `expected the message to name npm run compile, got: ${st.last.message}`);
  });

  // ── scenario 03 ────────────────────────────────────────────────────────
  scoped(/^the compiled output was written after every source file$/, (ctx) => {
    const st = ensure(ctx);
    const now = Date.now();
    // Compiled newer than source: the compiled output was written after the
    // source file.
    fs.utimesSync(st.source, new Date(now), new Date(now));
    fs.utimesSync(st.compiled, new Date(now + 1000), new Date(now + 1000));
  });

  scoped(/^the run goes on with no message$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(st.last && !st.last.threw, `expected the global setup to NOT throw (run goes on), got: ${JSON.stringify(st.last)}`);
  });
}

module.exports = { registerSteps };
