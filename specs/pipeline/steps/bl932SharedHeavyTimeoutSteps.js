'use strict';

// BL-932: step handlers for "subprocess-heavy property tests carry the
// shared heavy timeout, declared once". Parses the REAL property-lane test
// files and config via sharedHeavyTimeoutGuard's pure text-parsing helpers
// - never re-implements that parsing here, same "one checker, fuzzed by the
// property test and applied to reality by the step handler" split as
// bl871PropertyLaneWorkerPoolCapSteps.js/workerPoolConfigGuard.js.
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const TEST_DIR = path.join(EXTENSION_DIR, 'test');
const HELPERS_DIR = path.join(TEST_DIR, 'helpers');
const HELPER_FILE = path.join(HELPERS_DIR, 'subprocessHeavyTimeout.js');
const PROPERTIES_CONFIG = path.join(EXTENSION_DIR, 'vitest.properties.config.mjs');
const REPORTED_TEST_FILE = path.join(TEST_DIR, 'onboarderLauncherPidGuard.property.test.js');
const ADOPTER_FILES = [
  'bl760DuplicateChainGuard.property.test.js',
  'bl787NamedTunnelInvariants.property.test.js',
  'bl797MutationGateProbeCrashFallback.property.test.js',
  'onboarderLauncherPidGuard.property.test.js',
].map((f) => path.join(TEST_DIR, f));

const {
  declaresLocalConstant,
  importsSharedHeavyTimeout,
  usesSharedHeavyTimeoutOnly,
  outerTimeoutArgText,
  innerSpawnTimeoutMs,
  CONSTANT_NAME,
} = require(path.join(HELPERS_DIR, 'sharedHeavyTimeoutGuard'));

const FEATURE_NAME = 'subprocess-heavy property tests carry the shared heavy timeout, declared once';

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const KNOWN_KNOBS = {
  'inner subprocess timeout': 'inner',
  'outer per-test timeout': 'outer',
};
function knownKnob(value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_KNOBS, value)) {
    throw new Error(`bl932: unrecognized <knob> example value "${value}"`);
  }
  return KNOWN_KNOBS[value];
}

function readTestTimeout(configSource) {
  const m = /testTimeout\s*:\s*(\d+)/.exec(configSource);
  return m ? Number(m[1]) : undefined;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the property lane config declares its own suite-wide default timeout$/,
    (ctx) => {
      ctx.propertiesConfigSource = fs.readFileSync(PROPERTIES_CONFIG, 'utf8');
      ctx.laneTestTimeout = readTestTimeout(ctx.propertiesConfigSource);
      if (typeof ctx.laneTestTimeout !== 'number') {
        throw new Error(`expected ${PROPERTIES_CONFIG} to declare a numeric testTimeout`);
      }
    },
    FEATURE_NAME
  );

  // ── shared-heavy-timeout-01 / 03 Given ──────────────────────────────
  registry.defineScoped(
    /^the property test that drives the real launcher once per generated run$/,
    (ctx) => {
      ctx.reportedTestFile = REPORTED_TEST_FILE;
      ctx.reportedTestSource = fs.readFileSync(REPORTED_TEST_FILE, 'utf8');
    },
    FEATURE_NAME
  );

  // ── shared-heavy-timeout-01 ──────────────────────────────────────────
  registry.defineScoped(
    /^its test declaration is inspected$/,
    (ctx) => {
      ctx.outerTimeoutText = outerTimeoutArgText(ctx.reportedTestSource);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it declares an outer per-test timeout as the third argument to test$/,
    (ctx) => {
      if (!ctx.outerTimeoutText) {
        throw new Error(`expected ${ctx.reportedTestFile}'s test() call to carry a third (outer timeout) argument, found none`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^that timeout is the shared heavy-subprocess value$/,
    (ctx) => {
      if (!importsSharedHeavyTimeout(ctx.reportedTestSource)) {
        throw new Error(`expected ${ctx.reportedTestFile} to import ${CONSTANT_NAME} from the shared helper module`);
      }
      if (ctx.outerTimeoutText.trim() !== CONSTANT_NAME) {
        throw new Error(`expected the outer timeout argument to be the shared ${CONSTANT_NAME} identifier, got ${JSON.stringify(ctx.outerTimeoutText)}`);
      }
      if (declaresLocalConstant(ctx.reportedTestSource)) {
        throw new Error(`expected ${ctx.reportedTestFile} to carry no local copy of ${CONSTANT_NAME}`);
      }
    },
    FEATURE_NAME
  );

  // ── shared-heavy-timeout-02 ──────────────────────────────────────────
  registry.defineScoped(
    /^the property lane is searched for the shared heavy-subprocess constant$/,
    (ctx) => {
      const candidates = [
        ...fs.readdirSync(TEST_DIR).filter((f) => f.endsWith('.js')).map((f) => path.join(TEST_DIR, f)),
        ...fs.readdirSync(HELPERS_DIR).filter((f) => f.endsWith('.js')).map((f) => path.join(HELPERS_DIR, f)),
      ];
      ctx.declarers = candidates.filter((f) => declaresLocalConstant(fs.readFileSync(f, 'utf8')));
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^exactly one declaration of its value exists$/,
    (ctx) => {
      if (ctx.declarers.length !== 1) {
        throw new Error(`expected exactly one declaration of ${CONSTANT_NAME} across the property lane, found ${ctx.declarers.length}: ${JSON.stringify(ctx.declarers)}`);
      }
      if (ctx.declarers[0] !== HELPER_FILE) {
        throw new Error(`expected the one declaration to be the shared helper ${HELPER_FILE}, found it in ${ctx.declarers[0]}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^every test file that uses it imports that single declaration$/,
    () => {
      for (const file of ADOPTER_FILES) {
        const source = fs.readFileSync(file, 'utf8');
        if (!usesSharedHeavyTimeoutOnly(source)) {
          throw new Error(`expected ${file} to import ${CONSTANT_NAME} from the shared helper and declare no local copy`);
        }
      }
    },
    FEATURE_NAME
  );

  // ── shared-heavy-timeout-03 (Scenario Outline) ───────────────────────
  registry.defineScoped(
    /^the "([^"]+)" is inspected$/,
    (ctx, knob) => {
      ctx.knob = knownKnob(knob);
      ctx.knobValue = ctx.knob === 'inner' ? innerSpawnTimeoutMs(ctx.reportedTestSource) : outerTimeoutArgText(ctx.reportedTestSource);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it is still declared explicitly$/,
    (ctx) => {
      if (ctx.knobValue === undefined || ctx.knobValue === null || ctx.knobValue === '') {
        throw new Error(`expected the "${ctx.knob}" knob to be declared explicitly in ${ctx.reportedTestFile}, found nothing`);
      }
    },
    FEATURE_NAME
  );

  // ── shared-heavy-timeout-04 ───────────────────────────────────────────
  registry.defineScoped(
    /^the property lane config is inspected$/,
    (ctx) => {
      ctx.propertiesConfigSource = fs.readFileSync(PROPERTIES_CONFIG, 'utf8');
      ctx.laneTestTimeout = readTestTimeout(ctx.propertiesConfigSource);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^its suite-wide default timeout is still (\d+) milliseconds$/,
    (ctx, expected) => {
      if (ctx.laneTestTimeout !== Number(expected)) {
        throw new Error(`expected the property lane's suite-wide testTimeout to be ${expected}ms, got ${ctx.laneTestTimeout}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
