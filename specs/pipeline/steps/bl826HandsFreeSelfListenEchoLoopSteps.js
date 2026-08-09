'use strict';

// BL-826: step handlers for "Bubble does not open the mic onto its own
// voice". The re-arm decision (HandsFreeReArmGate.decide) is pure logic with
// no android.* type in its own signature, so per the constitution's
// Testability Boundary — Bubble it is verified by the JVM unit suite, same
// seam BL-769 established (specs/pipeline/steps/lib/androidGradle.js). Drives
// the REAL gradlew :app:testDebugUnitTest task — a stubbed runner would prove
// nothing about whether HandsFreeReArmGateTest actually exercises each
// decision.
const {
  registerAndroidModuleBackground,
  registerJvmUnitSuiteRun,
  registerKnownValueLookup,
} = require('./lib/androidJvmDecisionSteps');

const FEATURE_NAME = 'Bubble does not open the mic onto its own voice';
const TEST_REPORT_DIR = 'testDebugUnitTest';

// Explicit KNOWN_VALUES for the Scenario Outline - no passthrough/binary
// check on <decision> (BL-233). Each decision string is the exact
// (coder-authored, pre-existing) @Test name in HandsFreeReArmGateTest.kt —
// the gate's own decision reasons were named to match this feature's
// examples verbatim.
const KNOWN_DECISIONS = {
  'refusing to arm the mic while playback is still reported active': {
    classSubstring: 'HandsFreeReArmGateTest',
    nameSubstring: 'refusing to arm the mic while playback is still reported active',
  },
  'refusing to arm until a quiet tail has followed the playback-done signal': {
    classSubstring: 'HandsFreeReArmGateTest',
    nameSubstring: 'refusing to arm until a quiet tail has followed the playback-done signal',
  },
  'restarting the quiet tail when audio resumes before it completes': {
    classSubstring: 'HandsFreeReArmGateTest',
    nameSubstring: 'restarting the quiet tail when audio resumes before it completes',
  },
  'arming the mic once an uninterrupted quiet tail has elapsed': {
    classSubstring: 'HandsFreeReArmGateTest',
    nameSubstring: 'arming the mic once an uninterrupted quiet tail has elapsed',
  },
  'discarding audio captured inside the post-arm settle window': {
    classSubstring: 'HandsFreeReArmGateTest',
    nameSubstring: 'discarding audio captured inside the post-arm settle window',
  },
  'arming after a failed turn that produced no playback at all': {
    classSubstring: 'HandsFreeReArmGateTest',
    nameSubstring: 'arming after a failed turn that produced no playback at all',
  },
};

function registerSteps(registry) {
  registerAndroidModuleBackground(registry, FEATURE_NAME, __dirname);
  registerJvmUnitSuiteRun(registry, FEATURE_NAME, TEST_REPORT_DIR);
  // BL-826 hands-free-self-listen-echo-loop-01 (Then, Scenario Outline).
  // requireZeroStatus=true: unlike BL-769's lookup, this is the only Then
  // step in the scenario, so it must itself confirm the gradlew run
  // succeeded before trusting any JUnit result.
  registerKnownValueLookup(registry, FEATURE_NAME, KNOWN_DECISIONS, 'decision', true);
}

module.exports = { registerSteps };
