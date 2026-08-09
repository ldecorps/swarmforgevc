'use strict';

// BL-769: step handlers for "Bubble's pure logic is verified by a JVM unit
// suite that runs without a device". Drives the REAL gradlew
// :app:testDebugUnitTest task against android/ - same "drive the real thing,
// not a fixture" posture as bl663PromotionGatesSteps.js - because this
// feature's own claim IS that the real task runs and is load-bearing; a
// stubbed runner would prove nothing about either.
//
// Scenario 02 injects a deliberately-failing test file into
// android/app/src/test/ to prove the gate is load-bearing, then removes it.
// Cleanup happens in a try/finally around the assertion (so a thrown
// assertion still cleans up) AND via fixtureReaper's onAbnormalExit (so a
// killed runner process does too) - same double-guarantee bl458's
// fixtureReaper was built for.
const fs = require('node:fs');
const path = require('node:path');
const { onAbnormalExit } = require('./lib/fixtureReaper');
const {
  registerAndroidModuleBackground,
  registerJvmUnitSuiteRun,
  registerKnownValueLookup,
} = require('./lib/androidJvmDecisionSteps');

const FEATURE_NAME = "Bubble's pure logic is verified by a JVM unit suite that runs without a device";
const TEST_REPORT_DIR = 'testDebugUnitTest';
const CANARY_CLASS_NAME = 'BL769LoadBearingCanaryTest';

// Explicit KNOWN_VALUES for the Scenario Outline - no passthrough/binary
// checks on <behavior>. Each maps to the real test class + a substring its
// own (real, coder-authored) test name carries.
const KNOWN_BEHAVIORS = {
  'parsing a pairing deep link': {
    classSubstring: 'PairingDeepLinkTest',
    nameSubstring: 'parses a well-formed pairing link',
  },
  'classifying an unresolvable host as a failure': {
    classSubstring: 'BridgeClientTest',
    nameSubstring: 'unresolvable host',
  },
};

function canaryFilePath(ctx) {
  return path.join(
    ctx.androidDir,
    'app',
    'src',
    'test',
    'java',
    'com',
    'swarmforge',
    'floatcompanion',
    `${CANARY_CLASS_NAME}.kt`
  );
}

function removeCanary(ctx) {
  const target = canaryFilePath(ctx);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }
}

function registerSteps(registry) {
  registerAndroidModuleBackground(registry, FEATURE_NAME, __dirname);

  // ── android-pure-logic-jvm-unit-seam-02 (Given) ──────────────────────
  registry.defineScoped(
    /^a deliberately failing assertion is added to the JVM unit suite$/,
    (ctx) => {
      removeCanary(ctx); // defensive: never let a prior interrupted run's canary linger
      onAbnormalExit(() => removeCanary(ctx));
      const body = `package com.swarmforge.floatcompanion

import org.junit.Assert.assertTrue
import org.junit.Test

// BL-769 acceptance scenario 02 fixture - proves the gate is load-bearing.
// Written by the acceptance step itself and removed before the scenario
// ends; never committed.
class ${CANARY_CLASS_NAME} {
    @Test
    fun \`a deliberately failing assertion\`() {
        assertTrue(false)
    }
}
`;
      fs.mkdirSync(path.dirname(canaryFilePath(ctx)), { recursive: true });
      fs.writeFileSync(canaryFilePath(ctx), body);
      ctx.canaryInjected = true;
    },
    FEATURE_NAME
  );

  // ── When (shared by all three scenarios) ─────────────────────────────
  registerJvmUnitSuiteRun(registry, FEATURE_NAME, TEST_REPORT_DIR);

  // ── android-pure-logic-jvm-unit-seam-01 (Then) ───────────────────────
  registry.defineScoped(
    /^it completes and reports a passing result$/,
    (ctx) => {
      if (ctx.result.status !== 0) {
        throw new Error(
          `expected gradlew :app:testDebugUnitTest to exit 0, got ${ctx.result.status}. output:\n` +
            `${ctx.result.stdout}\n${ctx.result.stderr}`
        );
      }
      if (ctx.junitResults.length === 0) {
        throw new Error('expected at least one JUnit test result, found none');
      }
      const failed = ctx.junitResults.filter((r) => !r.passed);
      if (failed.length > 0) {
        throw new Error(`expected every test to pass, but these failed: ${JSON.stringify(failed)}`);
      }
    },
    FEATURE_NAME
  );

  // ── android-pure-logic-jvm-unit-seam-02 (Then) ───────────────────────
  registry.defineScoped(
    /^it reports a failing result$/,
    (ctx) => {
      try {
        if (ctx.result.status === 0) {
          throw new Error('expected gradlew :app:testDebugUnitTest to exit non-zero with the canary failure present');
        }
        const canaryResults = ctx.junitResults.filter((r) => r.classname.includes(CANARY_CLASS_NAME));
        if (canaryResults.length === 0) {
          throw new Error(`expected a JUnit result for ${CANARY_CLASS_NAME}, found none`);
        }
        if (canaryResults.every((r) => r.passed)) {
          throw new Error(`expected ${CANARY_CLASS_NAME} to be reported as failed, but it passed`);
        }
      } finally {
        removeCanary(ctx);
        ctx.canaryInjected = false;
      }
    },
    FEATURE_NAME
  );

  // ── android-pure-logic-jvm-unit-seam-03 (Then, Scenario Outline) ─────
  registerKnownValueLookup(registry, FEATURE_NAME, KNOWN_BEHAVIORS, 'behavior', false);
}

module.exports = { registerSteps };
