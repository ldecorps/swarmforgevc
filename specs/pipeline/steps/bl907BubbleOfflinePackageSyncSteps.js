'use strict';

// BL-907: step handlers for "Bubble keeps the bridge's packages on the
// device, refreshes them cheaply, and never presents cached data as live"
// (specs/features/BL-907-bubble-offline-package-sync.feature).
//
// Per the constitution's Testability Boundary — Bubble, every sync/cache
// DECISION this feature describes is pure Kotlin (CompanionPackageSync, no
// android.* type in its own signature), verified by the REAL
// `gradlew :app:testDebugUnitTest` task (specs/pipeline/steps/lib/androidGradle.js,
// the BL-769 seam, same posture as bl864BubbleSettingsVoiceEngineSelectorSteps.js /
// bl765BubbleRemoteConfigChiptuneCatalogSteps.js). The generation labels in
// the feature text ("aaaa1111", "bbbb2222") are symbolic scenario
// vocabulary, not literal hashes BL-866 would ever produce - each Given
// step records which of CompanionPackageSyncTest's coder-authored tests
// that scenario's shape maps to (first-sync / unchanged / moved / offline-
// read / one of the four failure kinds / nothing-held); the Then/And steps
// run the suite once per scenario and assert that specific test passed.
const fs = require('node:fs');
const path = require('node:path');
const { runGradle, readJUnitResults } = require('./lib/androidGradle');

const FEATURE_NAME =
  "Bubble keeps the bridge's packages on the device, refreshes them cheaply, and never presents cached data as live";
const TEST_REPORT_DIR = 'testDebugUnitTest';
const TEST_CLASS = 'CompanionPackageSyncTest';

const FAILURE_TEST_NAMES = {
  unreachable: 'an unreachable bridge leaves the cached copy intact and reports the failure',
  unreadable: 'an unreadable package leaves the cached copy intact and reports the failure',
  unknown: 'an unknown package leaves the cached copy intact and reports the failure',
  interrupted: 'an interrupted transfer leaves the cached copy intact and reports the failure',
};

function repoRootFromHere() {
  return path.join(__dirname, '..', '..', '..');
}

function runJvmSuite(ctx) {
  if (ctx.jvmResult) {
    return; // one gradlew run serves every step within a scenario.
  }
  ctx.repoRoot = repoRootFromHere();
  ctx.androidDir = path.join(ctx.repoRoot, 'android');
  ctx.jvmResult = runGradle(ctx.repoRoot, [':app:testDebugUnitTest', '--console=plain']);
  ctx.junitResults = readJUnitResults(ctx.androidDir, TEST_REPORT_DIR);
}

function assertKnownTestPassed(ctx, nameSubstring, describeFor) {
  if (ctx.jvmResult.status !== 0) {
    throw new Error(
      `expected gradlew :app:testDebugUnitTest to exit 0 for "${describeFor}", got ${ctx.jvmResult.status}. output:\n` +
        `${ctx.jvmResult.stdout}\n${ctx.jvmResult.stderr}`
    );
  }
  const matches = ctx.junitResults.filter((r) => r.classname.includes(TEST_CLASS) && r.name.includes(nameSubstring));
  if (matches.length === 0) {
    throw new Error(
      `expected a passed test in ${TEST_CLASS} naming "${nameSubstring}" for "${describeFor}", ` +
        `found none among: ${JSON.stringify(ctx.junitResults)}`
    );
  }
  if (matches.some((r) => !r.passed)) {
    throw new Error(`expected the matching test(s) for "${describeFor}" to have passed: ${JSON.stringify(matches)}`);
  }
}

// Disambiguates the two identically-worded "Then the held ... is the body
// served/labelled ..." steps shared across scenarios 1/3/4/5, and the two
// nothing-held steps shared with scenario 6, by the context each scenario's
// own Given/When steps recorded — same ctx.scenarioKind precedent as
// bl864BubbleSettingsVoiceEngineSelectorSteps.js / bl717's ctx.branch.
function currentExpectedTest(ctx) {
  if (ctx.failureMode) {
    return FAILURE_TEST_NAMES[ctx.failureMode];
  }
  if (ctx.action === 'read' && ctx.deviceHeldBefore === false) {
    return 'before any successful sync a read reports nothing held, not an empty package';
  }
  if (ctx.action === 'read' && ctx.deviceHeldBefore === true) {
    return 'a read is served from the cache, labelled at its own generation, no fetch involved';
  }
  if (ctx.action === 'synced' && ctx.deviceHeldBefore === false) {
    return 'a first successful sync caches the served body at the generation it was served';
  }
  if (ctx.action === 'synced' && ctx.deviceHeldBefore === true && ctx.movedGeneration) {
    return 'a moved generation replaces the cached copy and the label moves with it';
  }
  if (ctx.action === 'synced' && ctx.deviceHeldBefore === true) {
    return 'an unchanged answer keeps the cached copy exactly as held';
  }
  throw new Error(
    `cannot determine expected test for scenario state: ${JSON.stringify({
      failureMode: ctx.failureMode,
      action: ctx.action,
      deviceHeldBefore: ctx.deviceHeldBefore,
      movedGeneration: ctx.movedGeneration,
    })}`
  );
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^Bubble is paired with a bridge$/,
    (ctx) => {
      ctx.repoRoot = repoRootFromHere();
      ctx.androidDir = path.join(ctx.repoRoot, 'android');
      if (!fs.existsSync(path.join(ctx.androidDir, 'gradlew'))) {
        throw new Error(`expected android/gradlew under ${ctx.androidDir}`);
      }
      const syncFile = path.join(
        ctx.androidDir,
        'app',
        'src',
        'main',
        'java',
        'com',
        'swarmforge',
        'floatcompanion',
        'CompanionPackageSync.kt'
      );
      if (!fs.existsSync(syncFile)) {
        throw new Error(`expected ${syncFile}`);
      }
      ctx.generationLabels = new Set();
    },
    FEATURE_NAME
  );

  // ── Given: generation bookkeeping (symbolic labels, e.g. "aaaa1111") ──
  registry.defineScoped(
    /^the bridge has "([^"]+)" at generation "([^"]+)"$/,
    (ctx, _pkgName, label) => {
      if (!ctx.generationLabels.has(label) && ctx.generationLabels.size > 0) {
        ctx.movedGeneration = true;
      }
      ctx.generationLabels.add(label);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the device holds the "([^"]+)" package at generation "([^"]+)"$/,
    (ctx, _pkgName, label) => {
      ctx.deviceHeldBefore = true;
      ctx.generationLabels.add(label);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^nothing has been cached on the device$/,
    (ctx) => {
      ctx.deviceHeldBefore = false;
    },
    FEATURE_NAME
  );

  // scenario-04 only: sets no failure mode of its own — a straight offline
  // READ (no sync attempted) is disambiguated from the failed-SYNC outline
  // below purely by ctx.action ('read' vs 'synced'), never by this step.
  registry.defineScoped(
    /^the bridge is unreachable$/,
    () => {},
    FEATURE_NAME
  );

  registry.defineScoped(
    /^syncing "([^"]+)" fails with "([^"]+)"$/,
    (ctx, _pkgName, failure) => {
      ctx.failureMode = failure;
    },
    FEATURE_NAME
  );

  // ── When ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^Bubble syncs$/,
    (ctx) => {
      ctx.action = 'synced';
      runJvmSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the "([^"]+)" package is read$/,
    (ctx) => {
      ctx.action = 'read';
      runJvmSuite(ctx);
    },
    FEATURE_NAME
  );

  // ── Then/And ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the bridge answers that "([^"]+)" is unchanged and sends no body$/,
    (ctx, pkgName) => {
      assertKnownTestPassed(ctx, currentExpectedTest(ctx), `${pkgName} unchanged generation costs no body`);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the held "([^"]+)" package is the body served at generation "([^"]+)"$/,
    (ctx, pkgName, label) => {
      assertKnownTestPassed(ctx, currentExpectedTest(ctx), `held ${pkgName} body at generation ${label}`);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the held "([^"]+)" package is labelled as of generation "([^"]+)"$/,
    (ctx, pkgName, label) => {
      assertKnownTestPassed(ctx, currentExpectedTest(ctx), `held ${pkgName} labelled at generation ${label}`);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the failure to refresh is reported$/,
    (ctx) => {
      assertKnownTestPassed(ctx, currentExpectedTest(ctx), 'the failure to refresh is reported');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the read reports that no copy is held$/,
    (ctx) => {
      assertKnownTestPassed(ctx, currentExpectedTest(ctx), 'the read reports that no copy is held');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no body is returned$/,
    (ctx) => {
      assertKnownTestPassed(ctx, currentExpectedTest(ctx), 'no body is returned');
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
