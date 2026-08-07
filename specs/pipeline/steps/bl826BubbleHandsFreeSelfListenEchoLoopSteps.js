'use strict';

// BL-826: step handlers for "Bubble does not open the mic onto its own
// voice" - the re-arm gate's Scenario Outline runs the real gradlew
// :app:testDebugUnitTest task (same posture as BL-769: driving the real
// task, not a fixture, because this feature's own claim is that the real
// task exercises the gate).
const fs = require('node:fs');
const path = require('node:path');
const { runGradle, readJUnitResults } = require('./lib/androidGradle');

const FEATURE_NAME = 'Bubble does not open the mic onto its own voice';
const TEST_REPORT_DIR = 'testDebugUnitTest';

// Explicit KNOWN_VALUES for the Scenario Outline - no passthrough/binary
// check on <decision>. Each maps to the real test class + a substring its
// own (real, coder-authored) test name carries - see
// HandsFreeReArmGateTest.kt.
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
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the Bubble Android module$/,
    (ctx) => {
      ctx.repoRoot = path.join(__dirname, '..', '..', '..');
      ctx.androidDir = path.join(ctx.repoRoot, 'android');
      if (!fs.existsSync(path.join(ctx.androidDir, 'gradlew'))) {
        throw new Error(`expected android/gradlew under ${ctx.androidDir}`);
      }
    },
    FEATURE_NAME
  );

  // ── When ──────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the JVM unit suite is run$/,
    (ctx) => {
      ctx.result = runGradle(ctx.repoRoot, [':app:testDebugUnitTest', '--console=plain']);
      ctx.junitResults = readJUnitResults(ctx.androidDir, TEST_REPORT_DIR);
      if (ctx.result.status !== 0) {
        throw new Error(
          `expected gradlew :app:testDebugUnitTest to exit 0, got ${ctx.result.status}. output:\n` +
            `${ctx.result.stdout}\n${ctx.result.stderr}`
        );
      }
    },
    FEATURE_NAME
  );

  // ── hands-free-self-listen-echo-loop-01 (Then, Scenario Outline) ──────
  registry.defineScoped(
    /^it exercises (.+)$/,
    (ctx, decision) => {
      const known = KNOWN_DECISIONS[decision];
      if (!known) {
        throw new Error(
          `unknown <decision> example "${decision}" - expected one of: ${Object.keys(KNOWN_DECISIONS).join(', ')}`
        );
      }
      const matches = ctx.junitResults.filter(
        (r) => r.classname.includes(known.classSubstring) && r.name.includes(known.nameSubstring)
      );
      if (matches.length === 0) {
        throw new Error(
          `expected a passed test in ${known.classSubstring} naming "${known.nameSubstring}" for decision ` +
            `"${decision}", found none among: ${JSON.stringify(ctx.junitResults)}`
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
