'use strict';

// BL-868: step handlers for "the property lane enforces the same isolation
// guards as the unit lane". Scenarios 01-03 drive REAL `npx vitest run`
// invocations of generated fixture property-test files through the actual
// vitest.properties.config.mjs (runAsPropertyLaneFixture, shared with this
// ticket's own coder-authored property test - one mechanism proven twice,
// never two independent reimplementations that could drift apart).
// Scenario 04 reads the two real Vitest config files' source text through
// the same pure guard (isolationSetupFilesGuard.js) the property test
// fuzzes. Registered via defineScoped (BL-425 pattern): several step texts
// here ("the run passes"/"the run fails") are generic enough phrasing that
// an unscoped registration could collide with an unrelated feature's own
// step of similar wording (see BL-867's own steps file for the same note).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const { runAsPropertyLaneFixture } = require(path.join(EXTENSION_DIR, 'test', 'helpers', 'propertyLaneFixtureRunner'));
const { configRegistersIsolationGuards, findMissingIsolationGuards } = require(path.join(EXTENSION_DIR, 'test', 'helpers', 'isolationSetupFilesGuard'));

const FEATURE_NAME = 'BL-868 the property lane enforces the same isolation guards as the unit lane';

const LEAKY_DIR_PREFIX = 'bl868-accept-dir-';
const LEAK_ENV_KEY = 'BL868_ACCEPTANCE_LEAK_PROBE';

function registerSteps(registry) {
  // ── property-lane-isolation-guards-01 ────────────────────────────────
  registry.defineScoped(
    /^a property test that creates a temp directory through the shared helper$/,
    (ctx) => {
      ctx.resultFile = path.join(os.tmpdir(), `bl868-accept-result-${process.pid}-${Date.now()}.json`);
      ctx.fixtureSource = [
        "'use strict';",
        "const fs = require('node:fs');",
        "const { mkTmpDir } = require('./helpers/tmpDir');",
        '',
        "test('creates a temp dir via the shared helper', () => {",
        `  const dir = mkTmpDir(${JSON.stringify(LEAKY_DIR_PREFIX)});`,
        `  fs.writeFileSync(${JSON.stringify(ctx.resultFile)}, JSON.stringify({ dir }));`,
        '});',
        '',
      ].join('\n');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no temp directory it created survives the run$/,
    (ctx) => {
      const { dir } = JSON.parse(fs.readFileSync(ctx.resultFile, 'utf8'));
      fs.rmSync(ctx.resultFile, { force: true });
      if (fs.existsSync(dir)) {
        throw new Error(`expected ${dir} to have been swept, but it still exists`);
      }
    },
    FEATURE_NAME
  );

  // ── property-lane-isolation-guards-02 ────────────────────────────────
  registry.defineScoped(
    /^a property test that leaves a process\.env key changed$/,
    (ctx) => {
      ctx.fixtureSource = [
        "'use strict';",
        '',
        "test('leaves an env key changed', () => {",
        `  process.env[${JSON.stringify(LEAK_ENV_KEY)}] = 'leaked';`,
        '});',
        '',
      ].join('\n');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the run fails$/,
    (ctx) => {
      if (ctx.result.status === 0) {
        throw new Error(`expected the run to fail, but it exited 0:\n${ctx.result.output}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the failure names the leaked key$/,
    (ctx) => {
      if (!ctx.result.output.includes(LEAK_ENV_KEY)) {
        throw new Error(`expected the failure to name ${LEAK_ENV_KEY}, got:\n${ctx.result.output}`);
      }
    },
    FEATURE_NAME
  );

  // ── property-lane-isolation-guards-03 ────────────────────────────────
  registry.defineScoped(
    /^a property test that sweeps its own state and restores the environment$/,
    (ctx) => {
      ctx.fixtureSource = [
        "'use strict';",
        "const { mkTmpDir } = require('./helpers/tmpDir');",
        '',
        "test('already clean', () => {",
        "  mkTmpDir('bl868-accept-clean-');",
        `  const prior = process.env[${JSON.stringify(LEAK_ENV_KEY)}];`,
        `  process.env[${JSON.stringify(LEAK_ENV_KEY)}] = 'temporary';`,
        `  if (prior === undefined) { delete process.env[${JSON.stringify(LEAK_ENV_KEY)}]; } else { process.env[${JSON.stringify(LEAK_ENV_KEY)}] = prior; }`,
        '});',
        '',
      ].join('\n');
    },
    FEATURE_NAME
  );

  // ── property-lane-isolation-guards-01/02/03 shared "When" ────────────
  registry.defineScoped(
    /^the property lane runs it$/,
    (ctx) => {
      ctx.result = runAsPropertyLaneFixture(ctx.fixtureSource);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the run passes$/,
    (ctx) => {
      if (ctx.result.status !== 0) {
        throw new Error(`expected the run to pass, got exit ${ctx.result.status}:\n${ctx.result.output}`);
      }
    },
    FEATURE_NAME
  );

  // ── property-lane-isolation-guards-04 (Scenario Outline) ─────────────
  registry.defineScoped(
    /^the Vitest configuration (vitest\.config\.mjs|vitest\.properties\.config\.mjs)$/,
    (ctx, configFile) => {
      ctx.configFile = configFile;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^its registered setup files are read$/,
    (ctx) => {
      ctx.configSource = fs.readFileSync(path.join(EXTENSION_DIR, ctx.configFile), 'utf8');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^they include the temp-directory sweep and the environment restore guard$/,
    (ctx) => {
      const missing = findMissingIsolationGuards(ctx.configSource);
      if (!configRegistersIsolationGuards(ctx.configSource) || missing.length > 0) {
        throw new Error(`expected ${ctx.configFile} to register both isolation guards, missing: ${missing.join(', ')}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
