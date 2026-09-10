'use strict';

// BL-1449: step handlers for "The operator_runtime.bb fixture dependency
// list is derived at load, never typed". Drives the real
// operatorRuntimeBbFixtureFiles.js/operatorRuntimeBbClosure.js and a real
// bb operator_runtime.bb --tick-once subprocess - never a reimplementation
// of the closure walk.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { computeClosure } = require('./lib/operatorRuntimeBbClosure');

const FIXTURE_FILES_MODULE_PATH = require.resolve('./lib/operatorRuntimeBbFixtureFiles');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIVE_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ENTRY_FILE = 'operator_runtime.bb';

const FEATURE = 'BL-1449 The operator_runtime.bb fixture dependency list is derived at load, never typed';

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function mkTmp(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedRoots.push(root);
  return root;
}

// "the fixture dependency list module is loaded" is taken literally: a
// fresh require, not the one cached from this file's own top-level
// requires - the assertion is about what module LOAD computes, not about
// reusing a value already sitting in memory.
function loadFixtureFilesModuleFresh() {
  delete require.cache[FIXTURE_FILES_MODULE_PATH];
  return require(FIXTURE_FILES_MODULE_PATH);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the tracked Babashka scripts under swarmforge\/scripts$/,
    (ctx) => {
      ctx.scriptsDir = LIVE_SCRIPTS_DIR;
    },
    FEATURE
  );

  // ── Scenario 01 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the fixture dependency list module is loaded$/,
    (ctx) => {
      ctx.fixtureModule = loadFixtureFilesModuleFresh();
    },
    FEATURE
  );

  registry.defineScoped(
    /^its exported list equals the closure computed from source, plus the declared extras, in a stable order$/,
    (ctx) => {
      const { OPERATOR_RUNTIME_BB_FILES, OPERATOR_RUNTIME_BB_DECLARED_EXTRAS } = ctx.fixtureModule;
      const expected = [...computeClosure(ctx.scriptsDir, ENTRY_FILE)].sort().concat(OPERATOR_RUNTIME_BB_DECLARED_EXTRAS);
      assert.deepEqual(OPERATOR_RUNTIME_BB_FILES, expected);
    },
    FEATURE
  );

  // ── Scenario 02 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^a scratch copy of swarmforge\/scripts where one closure file gains a load-file of a new script$/,
    (ctx) => {
      const root = mkTmp('sfvc-bl1449-scratch-');
      fs.cpSync(LIVE_SCRIPTS_DIR, root, { recursive: true });
      const stubName = 'zz_bl1449_probe_lib.bb';
      fs.writeFileSync(path.join(root, stubName), ';; BL-1449 scenario 02 scratch stub\n');
      const entryPath = path.join(root, ENTRY_FILE);
      const original = fs.readFileSync(entryPath, 'utf8');
      const loadForm = `\n(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "${stubName}")))\n`;
      fs.writeFileSync(entryPath, `${original}${loadForm}`);
      ctx.scratchScriptsDir = root;
      ctx.newScript = stubName;
      ctx.moduleSourceBefore = fs.readFileSync(FIXTURE_FILES_MODULE_PATH, 'utf8');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the fixture dependency list module is loaded against the scratch copy$/,
    (ctx) => {
      const { deriveOperatorRuntimeClosure } = loadFixtureFilesModuleFresh();
      ctx.scratchList = deriveOperatorRuntimeClosure(ctx.scratchScriptsDir);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the new script is in the exported list$/,
    (ctx) => {
      assert.ok(ctx.scratchList.includes(ctx.newScript), `expected "${ctx.newScript}" in ${JSON.stringify(ctx.scratchList)}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the module's source is unchanged$/,
    (ctx) => {
      const moduleSourceAfter = fs.readFileSync(FIXTURE_FILES_MODULE_PATH, 'utf8');
      assert.equal(moduleSourceAfter, ctx.moduleSourceBefore);
    },
    FEATURE
  );

  // ── Scenario 03 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^a disposable fixture root populated from the derived list$/,
    (ctx) => {
      const { OPERATOR_RUNTIME_BB_FILES } = loadFixtureFilesModuleFresh();
      const root = mkTmp('sfvc-bl1449-fixture-');
      const dest = path.join(root, 'swarmforge', 'scripts');
      fs.mkdirSync(dest, { recursive: true });
      fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
      for (const f of OPERATOR_RUNTIME_BB_FILES) {
        fs.copyFileSync(path.join(LIVE_SCRIPTS_DIR, f), path.join(dest, f));
      }
      ctx.fixtureRoot = root;
    },
    FEATURE
  );

  registry.defineScoped(
    /^bb operator_runtime\.bb is run against that root with --tick-once$/,
    (ctx) => {
      try {
        const stdout = execFileSync(
          'bb',
          [path.join(ctx.fixtureRoot, 'swarmforge', 'scripts', ENTRY_FILE), ctx.fixtureRoot, '--tick-once'],
          {
            encoding: 'utf8',
            env: {
              ...process.env,
              OPERATOR_SKIP_LAUNCH: '1',
              SWARMFORGE_SKIP_TUNNEL: '1',
              SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS: '',
            },
            timeout: 15000,
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        );
        ctx.tickResult = { output: stdout };
      } catch (err) {
        ctx.tickResult = { output: `${err.stdout || ''}${err.stderr || ''}` };
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^no FileNotFoundException is raised while loading Babashka sources$/,
    (ctx) => {
      assert.ok(
        !/FileNotFoundException.*\.bb\b/.test(ctx.tickResult.output),
        `expected no .bb-file FileNotFoundException, got:\n${ctx.tickResult.output}`
      );
    },
    FEATURE
  );
}

module.exports = { registerSteps };
