'use strict';

// BL-828: step handlers for "The collapsed Bubble arbitrates its own
// gestures". The gesture decider is pure logic with no android.* type in its
// own signature, so per the constitution's Testability Boundary — Bubble it
// is verified by the JVM unit suite through the BL-769 seam
// (specs/pipeline/steps/lib/androidGradle.js). Explicit KNOWN_VALUES map —
// no passthrough check (BL-233).
const {
  registerAndroidModuleBackground,
  registerJvmUnitSuiteRun,
  registerKnownValueLookup,
} = require('./lib/androidJvmDecisionSteps');

const FEATURE_NAME = 'The collapsed Bubble arbitrates its own gestures';
const TEST_REPORT_DIR = 'testDebugUnitTest';

const KNOWN_DECISIONS = {
  'holding an idle tap until the double-tap window has expired': {
    classSubstring: 'BubbleGestureDeciderTest',
    nameSubstring: 'holding an idle tap until the double-tap window has expired',
  },
  'starting the mic when the double-tap window expires with no second tap': {
    classSubstring: 'BubbleGestureDeciderTest',
    nameSubstring: 'starting the mic when the double-tap window expires with no second tap',
  },
  'expanding the panel when a second tap arrives inside the window': {
    classSubstring: 'BubbleGestureDeciderTest',
    nameSubstring: 'expanding the panel when a second tap arrives inside the window',
  },
  'cancelling the held mic start when the expand fires': {
    classSubstring: 'BubbleGestureDeciderTest',
    nameSubstring: 'cancelling the held mic start when the expand fires',
  },
  'sending immediately when a tap lands while recording': {
    classSubstring: 'BubbleGestureDeciderTest',
    nameSubstring: 'sending immediately when a tap lands while recording',
  },
  'expanding when a second tap follows a send inside the window': {
    classSubstring: 'BubbleGestureDeciderTest',
    nameSubstring: 'expanding when a second tap follows a send inside the window',
  },
  'resolving a pointer that exceeds touch slop as a drag and never as a tap': {
    classSubstring: 'BubbleGestureDeciderTest',
    nameSubstring: 'resolving a pointer that exceeds touch slop as a drag and never as a tap',
  },
  'leaving long-press pause and drag-to-teardown outcomes unchanged': {
    classSubstring: 'BubbleGestureDeciderTest',
    nameSubstring: 'leaving long-press pause and drag-to-teardown outcomes unchanged',
  },
};

function registerSteps(registry) {
  registerAndroidModuleBackground(registry, FEATURE_NAME, __dirname);
  registerJvmUnitSuiteRun(registry, FEATURE_NAME, TEST_REPORT_DIR);
  // requireZeroStatus=true: this Scenario Outline's only Then is the lookup,
  // so it must confirm gradlew exited 0 before trusting JUnit results.
  registerKnownValueLookup(registry, FEATURE_NAME, KNOWN_DECISIONS, 'decision', true);
}

module.exports = { registerSteps };
