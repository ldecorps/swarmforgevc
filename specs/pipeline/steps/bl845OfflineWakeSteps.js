'use strict';

// BL-845: step handlers for "\"hey bubble\" wakes the phone without the
// network".
//
// The Node acceptance runner cannot execute Kotlin, so - as BL-769 established
// and BL-777/BL-844 follow - each scenario is verified by running the REAL
// `gradlew :app:testDebugUnitTest` task and asserting that the specific,
// coder-authored JVM test which encodes it exists and passed. The mapping is an
// explicit table, never a passthrough.
//
// Three guards keep this from degrading into an assertion about test names:
//
//   1. Every claim must MATCH at least one real test and every match must have
//      passed - a missing test is a failure, not an empty pass.
//   2. The Background checks the ticket's own required_wiring against the live
//      source: the spotter really runs inside OverlayService, rather than
//      merely existing as a class (the BL-419 shape).
//   3. The colour scenario reads the hex values out of themes.xml and the
//      declared colour names out of WakeSpotter.kt, so "soft teal" is checked
//      against #2A9D8F on the actual surface rather than restated in
//      JavaScript.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runGradle, readJUnitResults } = require('./lib/androidGradle');

const FEATURE_NAME = '"hey bubble" wakes the phone without the network';
const TEST_REPORT_DIR = 'testDebugUnitTest';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ANDROID_DIR = path.join(REPO_ROOT, 'android');
const SRC_DIR = path.join(ANDROID_DIR, 'app', 'src', 'main', 'java', 'com', 'swarmforge', 'floatcompanion');
const THEMES_XML = path.join(ANDROID_DIR, 'app', 'src', 'main', 'res', 'values', 'themes.xml');

const UNIT_TEST = 'WakeSpotterTest';
const PROPERTY_TEST = 'WakeSpotterPropertyTest';

const WAKE_PHRASE = 'hey bubble';

// BL-421 Scenario Outline rule: explicit lookups, never a passthrough.
// Each row's expected stripping is computed here from the SAME rule the
// feature states in prose (drop the leading phrase), and then cross-checked
// against the Kotlin constant, so a row rewired to the wrong answer fails.
const KNOWN_HEARD = {
  'hey bubble what is the pipeline': 'what is the pipeline',
  'hey bubble': '',
  'hey bubble, stop the swarm': 'stop the swarm',
};

const KNOWN_PASSIVE_UTTERANCES = new Set(['what is the pipeline', 'the kettle is boiling', 'hey bumble']);

const KNOWN_COLOURS = {
  'soft teal': { name: 'sf_bubble_passive', hex: '2A9D8F' },
  red: { name: 'sf_bubble_recording', hex: 'DA3633' },
  amber: { name: 'sf_bubble_thinking', hex: 'D29922' },
  blue: { name: 'sf_bubble_speaking', hex: '1F6FEB' },
  gray: { name: 'sf_bubble_paused', hex: '6E7681' },
};

const KNOWN_STATE_COLOURS = {
  PassiveWake: 'soft teal',
  ActiveListen: 'red',
  Thinking: 'amber',
  Speaking: 'blue',
  Paused: 'gray',
  Error: 'red',
};

const CLAIMS = {
  'the phrase never travels': [
    { classSubstring: UNIT_TEST, nameSubstring: 'the wake phrase is stripped from the request it arrived with' },
    { classSubstring: UNIT_TEST, nameSubstring: 'no stripped text ever contains the wake phrase' },
    {
      classSubstring: PROPERTY_TEST,
      nameSubstring: 'the request never begins with the phrase, however many times it was said',
    },
  ],
  'passive is silent to the world': [
    {
      classSubstring: UNIT_TEST,
      nameSubstring: 'heard speech without the phrase asks nothing of the bridge or the model',
    },
    { classSubstring: UNIT_TEST, nameSubstring: 'a near-miss of the phrase does not wake' },
    {
      classSubstring: PROPERTY_TEST,
      nameSubstring: 'nothing the phone hears can produce anything but an ignore or a wake',
    },
    { classSubstring: PROPERTY_TEST, nameSubstring: 'an ignore never carries the utterance' },
  ],
  'a wake is acknowledged locally': [
    { classSubstring: UNIT_TEST, nameSubstring: 'the local acknowledgement does not wait on the bridge' },
  ],
  'an unreachable bridge is reported': [
    {
      classSubstring: UNIT_TEST,
      nameSubstring: 'an unreachable bridge is reported as the reason the turn failed, not swallowed',
    },
  ],
  'colour tells the truth about the mic': [
    { classSubstring: UNIT_TEST, nameSubstring: 'each session state maps to the colour the human confirmed' },
    { classSubstring: UNIT_TEST, nameSubstring: 'every bubble colour agrees with the resource themes xml declares' },
    { classSubstring: PROPERTY_TEST, nameSubstring: 'red is shown only for a hot mic or an error, and passive is never red' },
  ],
};

// The ticket's required_wiring, checked against the live source.
const REQUIRED_WIRING = {
  file: 'OverlayService.kt',
  needles: ['WakeSpotter.onHeard(', 'WakeSpotter.colourFor(', 'startWakeSpotter()'],
  why: 'the spotter must run inside the existing overlay foreground service, not merely exist as a class',
};

let suiteRun = null;

function jvmSuite() {
  if (suiteRun === null) {
    const result = runGradle(REPO_ROOT, [':app:testDebugUnitTest', '--console=plain']);
    suiteRun = { result, junitResults: readJUnitResults(ANDROID_DIR, TEST_REPORT_DIR) };
  }
  return suiteRun;
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
    /^hands-free mode is on$/,
    (ctx) => {
      const source = fs.readFileSync(path.join(SRC_DIR, REQUIRED_WIRING.file), 'utf8');
      for (const needle of REQUIRED_WIRING.needles) {
        assert.ok(
          source.includes(needle),
          `${REQUIRED_WIRING.file} does not contain "${needle}" - ${REQUIRED_WIRING.why}`
        );
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
        ctx.junitResults.some((r) => r.classname.includes(UNIT_TEST)),
        'the wake spotter has no JVM tests at all'
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the wake phrase is "([^"]+)"$/,
    (ctx, phrase) => {
      // Read from the production constant, not restated: a phrase change the
      // feature file did not follow fails here.
      const source = fs.readFileSync(path.join(SRC_DIR, 'WakeSpotter.kt'), 'utf8');
      const declared = /WAKE_PHRASE\s*=\s*"([^"]+)"/.exec(source);
      assert.ok(declared, 'WakeSpotter.kt declares no WAKE_PHRASE');
      assert.equal(declared[1], phrase);
      assert.equal(phrase, WAKE_PHRASE);
      ctx.wakePhrase = phrase;
    },
    FEATURE_NAME
  );

  // ── 01: the phrase never reaches the model ──────────────────────────────
  registry.defineScoped(
    /^the spotter reports a wake from "([^"]+)"$/,
    (ctx, heard) => {
      assert.ok(
        Object.prototype.hasOwnProperty.call(KNOWN_HEARD, heard),
        `unknown <heard> "${heard}" - known: ${Object.keys(KNOWN_HEARD).join(', ')}`
      );
      assert.ok(
        heard.toLowerCase().startsWith(ctx.wakePhrase),
        `"${heard}" is not a wake at all, so this row proves nothing about stripping`
      );
      ctx.heard = heard;
      assertClaim(ctx, 'the phrase never travels');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the text submitted as the turn is "(.*)"$/,
    (ctx, submitted) => {
      assert.equal(
        KNOWN_HEARD[ctx.heard],
        submitted,
        `the Examples row says "${ctx.heard}" submits "${submitted}"; the handler's own table disagrees`
      );
      assert.ok(
        !submitted.toLowerCase().includes(ctx.wakePhrase),
        'the submitted text still carries the wake phrase'
      );
    },
    FEATURE_NAME
  );

  // ── 02 (Given) and 04 (When) share this step text; one registration
  // serves both, rather than two patterns racing to match the same line.
  registry.defineScoped(
    /^the session is in "([^"]+)"$/,
    (ctx, state) => {
      ctx.state = state;
    },
    FEATURE_NAME
  );

  // ── 02: passive is silent ───────────────────────────────────────────────

  registry.defineScoped(
    /^the phone hears "([^"]+)"$/,
    (ctx, heard) => {
      assert.ok(
        KNOWN_PASSIVE_UTTERANCES.has(heard),
        `unknown <heard> "${heard}" - known: ${[...KNOWN_PASSIVE_UTTERANCES].join(', ')}`
      );
      assert.ok(
        !heard.toLowerCase().startsWith(ctx.wakePhrase),
        `"${heard}" IS the wake phrase, so this row cannot show passive silence`
      );
      ctx.heard = heard;
      assertClaim(ctx, 'passive is silent to the world');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no bridge request is made$/,
    (ctx) => {
      assert.equal(ctx.state, 'PassiveWake');
      assertClaim(ctx, 'passive is silent to the world');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no cloud speech service is called$/,
    (ctx) => {
      assert.equal(ctx.state, 'PassiveWake');
      assertClaim(ctx, 'passive is silent to the world');
    },
    FEATURE_NAME
  );

  // ── 03: local ack with no network ───────────────────────────────────────
  registry.defineScoped(
    /^the bridge cannot be reached$/,
    (ctx) => {
      ctx.bridgeReachable = false;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the wake is acknowledged locally$/,
    (ctx) => {
      assert.equal(ctx.bridgeReachable, false, 'this scenario only means anything with the bridge down');
      assertClaim(ctx, 'a wake is acknowledged locally');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the failure reported for the turn names that the bridge could not be reached$/,
    (ctx) => {
      assertClaim(ctx, 'an unreachable bridge is reported');
    },
    FEATURE_NAME
  );

  // ── 04: colour ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the bubble is coloured "([^"]+)"$/,
    (ctx, colourName) => {
      const colour = KNOWN_COLOURS[colourName];
      assert.ok(colour, `unknown <colour> "${colourName}" - known: ${Object.keys(KNOWN_COLOURS).join(', ')}`);
      const expected = KNOWN_STATE_COLOURS[ctx.state];
      assert.ok(expected, `unknown <state> "${ctx.state}" - known: ${Object.keys(KNOWN_STATE_COLOURS).join(', ')}`);
      assert.equal(
        expected,
        colourName,
        `the Examples row colours ${ctx.state} "${colourName}"; the human's confirmed table says "${expected}"`
      );
      // Checked on the real surface: the hex the phone will actually paint.
      const themes = fs.readFileSync(THEMES_XML, 'utf8');
      const declared = new RegExp(`<color name="${colour.name}">#FF([0-9A-Fa-f]{6})</color>`).exec(themes);
      assert.ok(declared, `themes.xml declares no ${colour.name}`);
      assert.equal(declared[1].toUpperCase(), colour.hex.toUpperCase());
      if (ctx.state === 'PassiveWake') {
        assert.notEqual(
          colour.name,
          KNOWN_COLOURS.red.name,
          'passive listening must never be red - red is reserved for a hot mic to the model'
        );
      }
      assertClaim(ctx, 'colour tells the truth about the mic');
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
