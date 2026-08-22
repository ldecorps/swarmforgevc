'use strict';

// BL-825: step handlers for "Bubble decides which UI bundle to render
// without ever losing its Talk surface"
// (specs/features/BL-825-bubble-remote-ui-bundle-resolution.feature).
//
// Per the constitution's Testability Boundary — Bubble, the resolver
// decision this feature describes is pure Kotlin (UiBundleResolver, no
// android.* type in its own signature), verified by the REAL
// `gradlew :app:testDebugUnitTest` task (specs/pipeline/steps/lib/androidGradle.js,
// the BL-769 seam, same posture as bl907BubbleOfflinePackageSyncSteps.js).
// The single Scenario Outline names six decisions directly in Gherkin text
// (no symbolic vocabulary to translate); KNOWN_VALUES maps each verbatim to
// the UiBundleResolverTest method that covers it — no passthrough check
// (BL-233).
const fs = require('node:fs');
const path = require('node:path');
const { runGradle, readJUnitResults } = require('./lib/androidGradle');

const FEATURE_NAME = "Bubble decides which UI bundle to render without ever losing its Talk surface";
const TEST_REPORT_DIR = 'testDebugUnitTest';
const TEST_CLASS = 'UiBundleResolverTest';

const KNOWN_VALUES = {
  'rendering a served bundle that is newer than the cached one':
    'rendering a served bundle that is newer than the cached one',
  'keeping the cached bundle when the served bundle is not newer':
    'keeping the cached bundle when the served bundle is not newer',
  'rejecting a malformed bundle whole and keeping the last good one':
    'rejecting a malformed bundle whole and keeping the last good one',
  'refusing a bundle whose minimum shell version exceeds the installed shell':
    'refusing a bundle whose minimum shell version exceeds the installed shell',
  'falling back to the native Talk surface when no bundle is available':
    'falling back to the native Talk surface when no bundle is available',
  'marking the rendered bundle stale when the bridge is unreachable':
    'marking the rendered bundle stale when the bridge is unreachable',
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

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the Bubble Android module$/,
    (ctx) => {
      ctx.repoRoot = repoRootFromHere();
      ctx.androidDir = path.join(ctx.repoRoot, 'android');
      const resolverFile = path.join(
        ctx.androidDir,
        'app',
        'src',
        'main',
        'java',
        'com',
        'swarmforge',
        'floatcompanion',
        'UiBundleResolver.kt'
      );
      if (!fs.existsSync(resolverFile)) {
        throw new Error(`expected ${resolverFile}`);
      }
    },
    FEATURE_NAME
  );

  // ── When ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the JVM unit suite is run$/,
    (ctx) => {
      runJvmSuite(ctx);
    },
    FEATURE_NAME
  );

  // ── Then ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^it exercises (.+)$/,
    (ctx, decision) => {
      const nameSubstring = KNOWN_VALUES[decision];
      if (!nameSubstring) {
        throw new Error(`no KNOWN_VALUES entry for decision "${decision}" — refusing a passthrough check (BL-233)`);
      }
      if (ctx.jvmResult.status !== 0) {
        throw new Error(
          `expected gradlew :app:testDebugUnitTest to exit 0 for "${decision}", got ${ctx.jvmResult.status}. output:\n` +
            `${ctx.jvmResult.stdout}\n${ctx.jvmResult.stderr}`
        );
      }
      const matches = ctx.junitResults.filter(
        (r) => r.classname.includes(TEST_CLASS) && r.name.includes(nameSubstring)
      );
      if (matches.length === 0) {
        throw new Error(
          `expected a passed test in ${TEST_CLASS} naming "${nameSubstring}" for "${decision}", ` +
            `found none among: ${JSON.stringify(ctx.junitResults)}`
        );
      }
      if (matches.some((r) => !r.passed)) {
        throw new Error(`expected the matching test(s) for "${decision}" to have passed: ${JSON.stringify(matches)}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
