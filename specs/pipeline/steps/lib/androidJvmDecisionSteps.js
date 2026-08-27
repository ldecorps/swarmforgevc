'use strict';

// Shared step registrations for features that verify a piece of Bubble's
// pure Kotlin logic via the real `gradlew :app:testDebugUnitTest` task (the
// seam BL-769 established). BL-769 and BL-826 each define their own
// FEATURE_NAME and an explicit KNOWN_VALUES map from Scenario Outline
// example text to the real test class/name that covers it (BL-233 - no
// passthrough), but both register an identical Background, an identical
// "the JVM unit suite is run" When, and an identical KNOWN_VALUES lookup
// Then - this module is that common part, extracted rather than
// copy-pasted a third time.
const fs = require('node:fs');
const path = require('node:path');
const { runGradle, readJUnitResults } = require('./androidGradle');

function registerAndroidModuleBackground(registry, featureName, callerDir) {
  registry.defineScoped(
    /^the Bubble Android module$/,
    (ctx) => {
      ctx.repoRoot = path.join(callerDir, '..', '..', '..');
      ctx.androidDir = path.join(ctx.repoRoot, 'android');
      if (!fs.existsSync(path.join(ctx.androidDir, 'gradlew'))) {
        throw new Error(`expected android/gradlew under ${ctx.androidDir}`);
      }
    },
    featureName
  );
}

function registerJvmUnitSuiteRun(registry, featureName, testReportDir) {
  registry.defineScoped(
    /^the JVM unit suite is run$/,
    (ctx) => {
      ctx.result = runGradle(ctx.repoRoot, [':app:testDebugUnitTest', '--console=plain']);
      ctx.junitResults = readJUnitResults(ctx.androidDir, testReportDir);
    },
    featureName
  );
}

// exampleLabel names the Scenario Outline placeholder in error messages
// ('decision' or 'behavior') so a lookup failure still names the right
// column from the feature's own Examples table. requireZeroStatus preserves
// a real per-feature difference: BL-826's lookup additionally requires the
// gradlew run itself to have exited 0 before trusting any JUnit result;
// BL-769's does not (its own Background/other Then steps already establish
// that). Do not default this away - it would change either feature's
// behavior.
function registerKnownValueLookup(registry, featureName, knownValues, exampleLabel, requireZeroStatus) {
  registry.defineScoped(
    /^it exercises (.+)$/,
    (ctx, example) => {
      const known = knownValues[example];
      if (!known) {
        throw new Error(
          `unknown <${exampleLabel}> example "${example}" - expected one of: ${Object.keys(knownValues).join(', ')}`
        );
      }
      if (requireZeroStatus && ctx.result.status !== 0) {
        throw new Error(
          `expected gradlew :app:testDebugUnitTest to exit 0, got ${ctx.result.status}. output:\n` +
            `${ctx.result.stdout}\n${ctx.result.stderr}`
        );
      }
      const matches = ctx.junitResults.filter(
        (r) => r.classname.includes(known.classSubstring) && r.name.includes(known.nameSubstring)
      );
      if (matches.length === 0) {
        throw new Error(
          `expected a passed test in ${known.classSubstring} naming "${known.nameSubstring}" for ${exampleLabel} ` +
            `"${example}", found none among: ${JSON.stringify(ctx.junitResults)}`
        );
      }
      if (matches.some((r) => !r.passed)) {
        throw new Error(
          `expected the matching test(s) for "${example}" to have passed: ${JSON.stringify(matches)}`
        );
      }
    },
    featureName
  );
}

module.exports = {
  registerAndroidModuleBackground,
  registerJvmUnitSuiteRun,
  registerKnownValueLookup,
};
