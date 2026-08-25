'use strict';

// BL-777: step handlers for "Bubble stops speaking when the human starts
// speaking over it" (slice A of the barge-in epic).
//
// The Node acceptance runner cannot execute Kotlin, so — exactly as BL-769
// established and BL-826 followed — each scenario is verified by running the
// REAL `gradlew :app:testDebugUnitTest` task and asserting that the specific,
// coder-authored JVM test which encodes that scenario exists and passed. The
// mapping is an explicit KNOWN_CLAIMS table, never a passthrough: renaming or
// deleting one of those tests fails the scenario that named it rather than
// quietly passing.
//
// Two guards keep this from degrading into an assertion about test NAMES:
//
//   1. Every claim must MATCH at least one real test and every match must
//      have passed. A missing test is a failure, not an empty pass.
//   2. The Background additionally checks the ticket's own required_wiring
//      against the live sources — TalkEngine really calls the detector, and
//      ReplyAudioPlayer really exposes the abort it calls. A green Kotlin
//      suite over a module nothing drives is the BL-419 shape this feature
//      exists to avoid, and no unit test can catch it from inside.
//
// Invariant (BL-968): module load is requires and pure constants only. The
// gradle run is memoized lazily at STEP time, so the module still loads
// without touching a JDK.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runGradle, readJUnitResults } = require('./lib/androidGradle');

const FEATURE_NAME = 'Bubble stops speaking when the human starts speaking over it';
const TEST_REPORT_DIR = 'testDebugUnitTest';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ANDROID_DIR = path.join(REPO_ROOT, 'android');
const SRC_DIR = path.join(ANDROID_DIR, 'app', 'src', 'main', 'java', 'com', 'swarmforge', 'floatcompanion');

const DETECTOR_TEST = 'BargeInDetectorTest';
const DETECTOR_PROPERTY_TEST = 'BargeInDetectorPropertyTest';

// BL-421 Scenario Outline rule: every Examples: column value is validated
// against an explicit lookup, never passed through — a gherkin-mutator edit
// into an unrecognised value must fail the scenario, not slip into an else
// branch.
const KNOWN_MODES = {
  'hands-free': 'HANDS_FREE',
  'push-to-talk': 'PUSH_TO_TALK',
};

const KNOWN_SOUNDS = {
  'speech above the onset threshold': {
    classSubstring: DETECTOR_TEST,
    nameSubstring: 'sustained speech over hands-free playback aborts it',
  },
  'ambient noise below it': {
    classSubstring: DETECTOR_TEST,
    nameSubstring: 'ambient noise below the onset threshold never aborts',
  },
  "Bubble's own output alone": {
    classSubstring: DETECTOR_TEST,
    nameSubstring: "Bubble's own output alone never aborts",
  },
};

const KNOWN_PLAYBACK_OUTCOMES = {
  stops: 'aborts',
  continues: 'never aborts',
};

// Each claim names the real test(s) that encode it. A claim with no match, or
// with a failing match, fails the scenario.
const KNOWN_CLAIMS = {
  'hands-free stop within budget': [
    { classSubstring: DETECTOR_TEST, nameSubstring: 'the abort lands inside the stop-latency budget' },
    {
      classSubstring: DETECTOR_PROPERTY_TEST,
      nameSubstring: 'an uninterrupted speech run always terminates the overlap within the stop-latency budget',
    },
  ],
  'hands-free listening after abort': [
    { classSubstring: DETECTOR_TEST, nameSubstring: 'sustained speech over hands-free playback aborts it' },
    {
      classSubstring: DETECTOR_PROPERTY_TEST,
      nameSubstring: 'no sequence stacks listening sessions, and an abort never leaves the mic closed',
    },
  ],
  'push-to-talk playback continues': [
    { classSubstring: DETECTOR_TEST, nameSubstring: 'no audio input aborts playback in push-to-talk' },
    {
      classSubstring: DETECTOR_PROPERTY_TEST,
      nameSubstring: 'no audio input aborts playback in push-to-talk, however loud or long',
    },
  ],
  'push-to-talk mic stays manual': [
    { classSubstring: DETECTOR_TEST, nameSubstring: 'no audio input aborts playback in push-to-talk' },
  ],
  'one listening session after repeated barge-ins': [
    { classSubstring: DETECTOR_TEST, nameSubstring: 'a second barge-in during the same playback changes nothing' },
    {
      classSubstring: DETECTOR_PROPERTY_TEST,
      nameSubstring: 'repeated and back-to-back barge-ins never open a second session',
    },
  ],
  'no playback still running after repeated barge-ins': [
    {
      classSubstring: DETECTOR_PROPERTY_TEST,
      nameSubstring: 'every abort stops playback in the same step, and the overlap always terminates',
    },
  ],
};

// The ticket's own required_wiring, checked against the live sources: a test
// suite that is green over a module nothing calls proves nothing about the
// feature.
const REQUIRED_WIRING = [
  {
    file: 'TalkEngine.kt',
    needles: ['BargeInDetector.frame(', 'BargeInDetector.playbackStarted(', 'replyPlayer?.abort('],
    why: 'the detector must be driven from the live talk loop, not only from tests',
  },
  {
    file: 'ReplyAudioPlayer.kt',
    needles: ['fun abort('],
    why: 'playback must expose the prompt abort the detector calls',
  },
];

// One gradle run for the whole feature file, built on first use.
let suiteRun = null;

function jvmSuite() {
  if (suiteRun === null) {
    const result = runGradle(REPO_ROOT, [':app:testDebugUnitTest', '--console=plain']);
    suiteRun = { result, junitResults: readJUnitResults(ANDROID_DIR, TEST_REPORT_DIR) };
  }
  return suiteRun;
}

function assertClaim(ctx, claimKey) {
  const claims = KNOWN_CLAIMS[claimKey];
  assert.ok(claims, `unknown claim "${claimKey}" - known: ${Object.keys(KNOWN_CLAIMS).join(', ')}`);
  for (const claim of claims) {
    assertNamedTestPassed(ctx, claim, claimKey);
  }
}

function assertNamedTestPassed(ctx, claim, label) {
  const matches = ctx.junitResults.filter(
    (r) => r.classname.includes(claim.classSubstring) && r.name.includes(claim.nameSubstring)
  );
  assert.ok(
    matches.length > 0,
    `no JVM test in ${claim.classSubstring} naming "${claim.nameSubstring}" for "${label}" - ` +
      'the test that encodes this scenario was renamed or removed'
  );
  const failed = matches.filter((r) => !r.passed);
  assert.equal(failed.length, 0, `the test(s) encoding "${label}" failed: ${JSON.stringify(failed)}`);
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^Bubble is speaking a reply aloud$/,
    (ctx) => {
      for (const wiring of REQUIRED_WIRING) {
        const source = fs.readFileSync(path.join(SRC_DIR, wiring.file), 'utf8');
        for (const needle of wiring.needles) {
          assert.ok(source.includes(needle), `${wiring.file} does not contain "${needle}" - ${wiring.why}`);
        }
      }
      const suite = jvmSuite();
      assert.equal(
        suite.result.status,
        0,
        `expected gradlew :app:testDebugUnitTest to exit 0, got ${suite.result.status}. output:\n` +
          `${suite.result.stdout}\n${suite.result.stderr}`
      );
      ctx.junitResults = suite.junitResults;
      assert.ok(
        ctx.junitResults.some((r) => r.classname.includes(DETECTOR_TEST)),
        'the barge-in detector has no JVM tests at all'
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the voice mode is (.+)$/,
    (ctx, mode) => {
      const known = KNOWN_MODES[mode];
      assert.ok(known, `unknown voice mode "${mode}" - known: ${Object.keys(KNOWN_MODES).join(', ')}`);
      ctx.mode = known;
    },
    FEATURE_NAME
  );

  // ── barge-in-01 / 03 ────────────────────────────────────────────────────
  registry.defineScoped(
    /^the human starts speaking over the playback$/,
    (ctx) => {
      assert.ok(ctx.mode, 'the scenario must fix a voice mode before the human speaks');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^playback stops within the stop-latency budget$/,
    (ctx) => {
      assert.equal(ctx.mode, 'HANDS_FREE', 'only hands-free may abort playback');
      assertClaim(ctx, 'hands-free stop within budget');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^Bubble is listening$/,
    (ctx) => {
      assert.equal(ctx.mode, 'HANDS_FREE');
      assertClaim(ctx, 'hands-free listening after abort');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^Bubble is not listening until the mic is activated manually$/,
    (ctx) => {
      assert.equal(ctx.mode, 'PUSH_TO_TALK');
      assertClaim(ctx, 'push-to-talk mic stays manual');
    },
    FEATURE_NAME
  );

  // ── barge-in-02 (Scenario Outline) ──────────────────────────────────────
  registry.defineScoped(
    /^(.+) is picked up during playback$/,
    (ctx, sound) => {
      const known = KNOWN_SOUNDS[sound];
      assert.ok(known, `unknown <sound> "${sound}" - known: ${Object.keys(KNOWN_SOUNDS).join(', ')}`);
      ctx.sound = sound;
      ctx.soundClaim = known;
    },
    FEATURE_NAME
  );

  // ONE handler for "playback stops"/"playback continues". Scenario 03's Then
  // renders byte-identically to a scenario 02 Examples row, so a second
  // pattern for it would be a silent first-registered-wins race. Which
  // scenario is speaking is decided by whether a <sound> was picked up.
  registry.defineScoped(
    /^playback (stops|continues)$/,
    (ctx, outcome) => {
      const expected = KNOWN_PLAYBACK_OUTCOMES[outcome];
      assert.ok(
        expected,
        `unknown <playback-outcome> "${outcome}" - known: ${Object.keys(KNOWN_PLAYBACK_OUTCOMES).join(', ')}`
      );
      if (!ctx.soundClaim) {
        // Scenario 03: the human spoke, and push-to-talk ignored them.
        assert.equal(outcome, 'continues', 'speech over hands-free playback must not be allowed to continue');
        assert.equal(ctx.mode, 'PUSH_TO_TALK', 'in hands-free, speech over playback must not be allowed to continue');
        assertClaim(ctx, 'push-to-talk playback continues');
        return;
      }
      // Scenario 02: the mapped test's own name states the outcome, so an
      // Examples row rewired to the wrong outcome fails here instead of
      // matching anyway.
      assert.ok(
        ctx.soundClaim.nameSubstring.includes(expected),
        `"${ctx.sound}" is encoded by a test named "${ctx.soundClaim.nameSubstring}", ` +
          `which does not state the outcome "${outcome}"`
      );
      assertNamedTestPassed(ctx, ctx.soundClaim, `${ctx.sound} -> ${outcome}`);
    },
    FEATURE_NAME
  );

  // ── barge-in-04 ─────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the human barges in twice in quick succession$/,
    (ctx) => {
      assert.equal(ctx.mode, 'HANDS_FREE');
      ctx.repeated = true;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^exactly one listening session is open$/,
    (ctx) => {
      assert.ok(ctx.repeated, 'this assertion belongs to the repeated barge-in scenario');
      assertClaim(ctx, 'one listening session after repeated barge-ins');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no playback is still running$/,
    (ctx) => {
      assert.ok(ctx.repeated, 'this assertion belongs to the repeated barge-in scenario');
      assertClaim(ctx, 'no playback still running after repeated barge-ins');
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
