'use strict';

// BL-844: step handlers for "the hands-free session - wake once, talk, then go
// quiet".
//
// The Node acceptance runner cannot execute Kotlin, so - as BL-769 established
// and BL-777 follows - each scenario is verified by running the REAL
// `gradlew :app:testDebugUnitTest` task and asserting that the specific,
// coder-authored JVM test which encodes that scenario exists and passed. The
// mapping is an explicit table, never a passthrough: renaming or deleting one
// of those tests fails the scenario that named it rather than quietly passing.
//
// Two guards keep this from degrading into an assertion about test NAMES.
// Every claim must MATCH at least one real test and every match must have
// passed, so a missing test is a failure rather than an empty pass. And the
// Background reads the state machine's OWN declared window constant out of the
// Kotlin source, so the feature's "the silence window is 10 seconds" is checked
// against the production value instead of restated in JavaScript.
//
// Invariant (BL-968): module load is requires and pure constants only. The
// gradle run is memoized lazily at STEP time, so the module still loads
// without touching a JDK.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runGradle, readJUnitResults } = require('./lib/androidGradle');

const FEATURE_NAME = 'the hands-free session - wake once, talk, then go quiet';
const TEST_REPORT_DIR = 'testDebugUnitTest';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ANDROID_DIR = path.join(REPO_ROOT, 'android');
const SESSION_SOURCE = path.join(
  ANDROID_DIR, 'app', 'src', 'main', 'java', 'com', 'swarmforge', 'floatcompanion', 'HandsFreeSession.kt'
);

const UNIT_TEST = 'HandsFreeSessionTest';
const PROPERTY_TEST = 'HandsFreeSessionPropertyTest';

// BL-421 Scenario Outline rule: every Examples: column value is validated
// against an explicit lookup, never passed through.
const KNOWN_STATES = new Set(['PassiveWake', 'ActiveListen', 'Thinking', 'Speaking']);

const KNOWN_SIGNALS = {
  'wake signal': {
    resultingState: 'ActiveListen',
    tests: [{ classSubstring: UNIT_TEST, nameSubstring: 'a wake signal opens a session' }],
  },
  'push-to-talk tap': {
    resultingState: 'ActiveListen',
    tests: [{ classSubstring: UNIT_TEST, nameSubstring: 'a push-to-talk tap opens a session' }],
  },
  'playback finished': {
    resultingState: 'PassiveWake',
    tests: [{ classSubstring: UNIT_TEST, nameSubstring: 'playback finishing while passive opens nothing' }],
  },
};

const KNOWN_SILENCE_OUTCOMES = {
  'nothing is heard': {
    resultingState: 'PassiveWake',
    tests: [
      { classSubstring: UNIT_TEST, nameSubstring: 'silence through the window returns the session to passive' },
      { classSubstring: PROPERTY_TEST, nameSubstring: 'an armed window always closes, and closes exactly at its boundary' },
    ],
  },
  'the human asks another question': {
    resultingState: 'Thinking',
    tests: [
      { classSubstring: UNIT_TEST, nameSubstring: 'a question inside the window is a normal turn and the window stops running' },
    ],
  },
};

const KNOWN_UTTERANCES = {
  'thank you': { kind: 'soft', turns: 0 },
  thanks: { kind: 'soft', turns: 0 },
  stop: { kind: 'hard' },
  "I'm done": { kind: 'hard' },
  goodbye: { kind: 'hard' },
  'what is the pipeline doing': { kind: 'question' },
  'and what about the backlog': { kind: 'question' },
};

const CLAIMS = {
  'passive speech reaches no model': [
    { classSubstring: UNIT_TEST, nameSubstring: 'speech while passive submits no turn and does not open a session' },
    { classSubstring: PROPERTY_TEST, nameSubstring: 'no utterance is ever submitted while the session is passive' },
    {
      classSubstring: PROPERTY_TEST,
      nameSubstring: 'no event sequence reaches a state where a passive session submits a turn',
    },
  ],
  'follow-up needs no wake signal': [
    { classSubstring: UNIT_TEST, nameSubstring: 'speech in an open session submits a turn and moves to Thinking' },
  ],
  'soft closer does not hold the session open': [
    { classSubstring: UNIT_TEST, nameSubstring: 'a soft closer submits no turn and does not restart the window' },
    { classSubstring: PROPERTY_TEST, nameSubstring: 'a soft closer cannot hold a session open, however many are said' },
  ],
  'hard end phrase ends it at once': [
    { classSubstring: UNIT_TEST, nameSubstring: 'a hard end phrase drops to passive without waiting the window out' },
    { classSubstring: PROPERTY_TEST, nameSubstring: 'from any reachable session a hard end phrase returns it to passive' },
  ],
  'barge-in reopens the mic': [
    {
      classSubstring: UNIT_TEST,
      nameSubstring: 'a barge-in while speaking returns to listening rather than ending the session',
    },
  ],
  'push-to-talk ignores the silence policy': [
    { classSubstring: UNIT_TEST, nameSubstring: 'with hands-free off no elapsed silence changes the session state' },
    { classSubstring: PROPERTY_TEST, nameSubstring: 'with hands-free off no elapsed silence ever changes the session state' },
  ],
};

let suiteRun = null;

function jvmSuite() {
  if (suiteRun === null) {
    const result = runGradle(REPO_ROOT, [':app:testDebugUnitTest', '--console=plain']);
    suiteRun = { result, junitResults: readJUnitResults(ANDROID_DIR, TEST_REPORT_DIR) };
  }
  return suiteRun;
}

function declaredSilenceWindowMs() {
  const source = fs.readFileSync(SESSION_SOURCE, 'utf8');
  const match = /DEFAULT_SILENCE_WINDOW_MS\s*=\s*([0-9_]+)L/.exec(source);
  assert.ok(match, 'HandsFreeSession.kt declares no DEFAULT_SILENCE_WINDOW_MS');
  return Number(match[1].replace(/_/g, ''));
}

function assertTestsPassed(ctx, tests, label) {
  for (const test of tests) {
    const matches = ctx.junitResults.filter(
      (r) => r.classname.includes(test.classSubstring) && r.name.includes(test.nameSubstring)
    );
    assert.ok(
      matches.length > 0,
      `no JVM test in ${test.classSubstring} naming "${test.nameSubstring}" for "${label}" - ` +
        'the test that encodes this scenario was renamed or removed'
    );
    const failed = matches.filter((r) => !r.passed);
    assert.equal(failed.length, 0, `the test(s) encoding "${label}" failed: ${JSON.stringify(failed)}`);
  }
}

function assertClaim(ctx, key) {
  const claim = CLAIMS[key];
  assert.ok(claim, `unknown claim "${key}" - known: ${Object.keys(CLAIMS).join(', ')}`);
  assertTestsPassed(ctx, claim, key);
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^hands-free mode is (on|off)$/,
    (ctx, mode) => {
      ctx.handsFree = mode === 'on';
      const suite = jvmSuite();
      assert.equal(
        suite.result.status,
        0,
        `expected gradlew :app:testDebugUnitTest to exit 0, got ${suite.result.status}. output:\n` +
          `${suite.result.stdout}\n${suite.result.stderr}`
      );
      ctx.junitResults = suite.junitResults;
      assert.ok(
        ctx.junitResults.some((r) => r.classname.includes(UNIT_TEST)),
        'the hands-free session machine has no JVM tests at all'
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the silence window is (\d+) seconds$/,
    (ctx, seconds) => {
      // Read from the production constant, not restated here: a change to the
      // window that the feature file did not follow fails this step.
      assert.equal(declaredSilenceWindowMs(), Number(seconds) * 1000);
      ctx.silenceWindowMs = Number(seconds) * 1000;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the session is in "([^"]+)"$/,
    (ctx, state) => {
      assert.ok(KNOWN_STATES.has(state), `unknown state "${state}" - known: ${[...KNOWN_STATES].join(', ')}`);
      // Used as both a Given (set the starting state) and a Then (assert the
      // resulting one). The Then form is the one an expectation was recorded
      // for by an earlier step in the same scenario.
      if (ctx.expectedState) {
        assert.equal(state, ctx.expectedState, 'the scenario asserts a state its own steps did not produce');
        ctx.expectedState = undefined;
        return;
      }
      ctx.state = state;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the session is still in "([^"]+)"$/,
    (ctx, state) => {
      assert.ok(KNOWN_STATES.has(state), `unknown state "${state}"`);
      assert.equal(state, ctx.expectedState, 'the scenario asserts a state its own steps did not produce');
      ctx.expectedState = undefined;
    },
    FEATURE_NAME
  );

  // ── 01 / 03 / 05 / 06: an utterance ────────────────────────────────────
  registry.defineScoped(
    /^the human says "([^"]+)"$/,
    (ctx, utterance) => {
      const known = KNOWN_UTTERANCES[utterance];
      assert.ok(known, `unknown utterance "${utterance}" - known: ${Object.keys(KNOWN_UTTERANCES).join(', ')}`);
      ctx.utterance = utterance;
      ctx.utteranceKind = known.kind;
      if (ctx.state === 'PassiveWake') {
        assertClaim(ctx, 'passive speech reaches no model');
        ctx.turnsSubmitted = 0;
        ctx.expectedState = 'PassiveWake';
        return;
      }
      if (known.kind === 'hard') {
        assertClaim(ctx, 'hard end phrase ends it at once');
        ctx.turnsSubmitted = 0;
        ctx.windowStillRunning = false;
        ctx.expectedState = 'PassiveWake';
        return;
      }
      if (known.kind === 'soft') {
        assertClaim(ctx, 'soft closer does not hold the session open');
        ctx.turnsSubmitted = 0;
        ctx.windowStillRunning = true;
        ctx.expectedState = 'ActiveListen';
        return;
      }
      assertClaim(ctx, 'follow-up needs no wake signal');
      ctx.turnsSubmitted = 1;
      ctx.expectedState = 'Thinking';
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no turn is submitted$/,
    (ctx) => {
      assert.equal(ctx.turnsSubmitted, 0);
      assertClaim(ctx, 'passive speech reaches no model');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a turn is submitted$/,
    (ctx) => {
      assert.equal(ctx.turnsSubmitted, 1);
      assertClaim(ctx, 'follow-up needs no wake signal');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the number of turns submitted for that utterance is (\d+)$/,
    (ctx, turns) => {
      const known = KNOWN_UTTERANCES[ctx.utterance];
      assert.equal(
        known.turns,
        Number(turns),
        `the Examples row says "${ctx.utterance}" submits ${turns} turns; the handler's own table says ${known.turns}`
      );
      assert.equal(ctx.turnsSubmitted, Number(turns));
    },
    FEATURE_NAME
  );

  // ── 02: signals ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the session receives a "([^"]+)"$/,
    (ctx, signal) => {
      const known = KNOWN_SIGNALS[signal];
      assert.ok(known, `unknown <signal> "${signal}" - known: ${Object.keys(KNOWN_SIGNALS).join(', ')}`);
      assertTestsPassed(ctx, known.tests, signal);
      ctx.expectedState = known.resultingState;
    },
    FEATURE_NAME
  );

  // ── 04: the silence window ─────────────────────────────────────────────
  registry.defineScoped(
    /^the session has just finished speaking an answer$/,
    (ctx) => {
      assertTestsPassed(
        ctx,
        [{ classSubstring: UNIT_TEST, nameSubstring: 'an answer arms the silence window and returns to listening' }],
        'an answer arms the window'
      );
      ctx.state = 'ActiveListen';
      ctx.windowStillRunning = true;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^(.+) after (\d+) seconds$/,
    (ctx, whatHappens, seconds) => {
      const known = KNOWN_SILENCE_OUTCOMES[whatHappens];
      assert.ok(
        known,
        `unknown <what happens> "${whatHappens}" - known: ${Object.keys(KNOWN_SILENCE_OUTCOMES).join(', ')}`
      );
      assert.ok(
        Number(seconds) * 1000 < ctx.silenceWindowMs,
        `${seconds}s must be INSIDE the ${ctx.silenceWindowMs}ms window, or this row tests nothing`
      );
      assertTestsPassed(ctx, known.tests, whatHappens);
      ctx.elapsedMs = Number(seconds) * 1000;
      ctx.expectedState = known.resultingState;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a further (\d+) seconds pass$/,
    (ctx, seconds) => {
      const total = ctx.elapsedMs + Number(seconds) * 1000;
      assert.ok(
        total >= ctx.silenceWindowMs,
        `${total}ms must reach the ${ctx.silenceWindowMs}ms window, or neither row can differ`
      );
      ctx.elapsedMs = total;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the silence window elapses with nothing further heard$/,
    (ctx) => {
      if (ctx.handsFree) {
        assertClaim(ctx, 'soft closer does not hold the session open');
        ctx.expectedState = 'PassiveWake';
      } else {
        // Invariant 3: with hands-free off the window is inert.
        assertClaim(ctx, 'push-to-talk ignores the silence policy');
        ctx.expectedState = ctx.state;
      }
      ctx.elapsedMs = ctx.silenceWindowMs;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the silence window is not being waited out$/,
    (ctx) => {
      assert.equal(ctx.windowStillRunning, false, 'a hard end phrase must leave no window running');
      assertClaim(ctx, 'hard end phrase ends it at once');
    },
    FEATURE_NAME
  );

  // ── 07: barge-in ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the session receives a barge-in signal$/,
    (ctx) => {
      assert.equal(ctx.state, 'Speaking', 'a barge-in only means anything while Bubble is speaking');
      assertClaim(ctx, 'barge-in reopens the mic');
      ctx.expectedState = 'ActiveListen';
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
