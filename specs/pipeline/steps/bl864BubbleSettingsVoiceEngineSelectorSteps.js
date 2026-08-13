'use strict';

// BL-864: step handlers for "Bubble Settings offers a Local or OpenAI voice
// engine and never lies about which one is in use".
//
// Per the constitution's Testability Boundary — Bubble, the selector's
// STATE decisions are VoiceEngineSelector.kt, pure Kotlin with no android.*
// type in its own signature, so they are verified by the REAL
// `gradlew :app:testDebugUnitTest` task (specs/pipeline/steps/lib/androidGradle.js,
// the seam BL-769 established, already reused by BL-826/BL-717 for their
// own Bubble features). The two claims that are genuinely device-surface —
// "no credential is included in what is sent" (BridgeClient's real network
// call) and "the other talk settings are still shown" (dialog layout) — are
// checked at the narrowest honest level available here: the coder-authored
// property test for the former, a layout-XML regression check for the
// latter. Neither is a passthrough/binary no-op (BL-233).
const fs = require('node:fs');
const path = require('node:path');
const { runGradle, readJUnitResults } = require('./lib/androidGradle');

const FEATURE_NAME = 'Bubble Settings offers a Local or OpenAI voice engine and never lies about which one is in use';
const TEST_REPORT_DIR = 'testDebugUnitTest';

function repoRootFromHere() {
  return path.join(__dirname, '..', '..', '..');
}

function runJvmSuite(ctx) {
  ctx.repoRoot = repoRootFromHere();
  ctx.androidDir = path.join(ctx.repoRoot, 'android');
  ctx.result = runGradle(ctx.repoRoot, [':app:testDebugUnitTest', '--console=plain']);
  ctx.junitResults = readJUnitResults(ctx.androidDir, TEST_REPORT_DIR);
}

function assertKnownTestPassed(ctx, classSubstring, nameSubstring, describeFor) {
  if (ctx.result.status !== 0) {
    throw new Error(
      `expected gradlew :app:testDebugUnitTest to exit 0 for "${describeFor}", got ${ctx.result.status}. output:\n` +
        `${ctx.result.stdout}\n${ctx.result.stderr}`
    );
  }
  const matches = ctx.junitResults.filter(
    (r) => r.classname.includes(classSubstring) && r.name.includes(nameSubstring)
  );
  if (matches.length === 0) {
    throw new Error(
      `expected a passed test in ${classSubstring} naming "${nameSubstring}" for "${describeFor}", ` +
        `found none among: ${JSON.stringify(ctx.junitResults)}`
    );
  }
  if (matches.some((r) => !r.passed)) {
    throw new Error(`expected the matching test(s) for "${describeFor}" to have passed: ${JSON.stringify(matches)}`);
  }
}

// The "shows X as selected" Then wording is shared by three different
// moments in the flow (fresh status, post-refusal, post-relaunch) — the
// earlier Given steps in each scenario record which one via ctx.scenarioKind
// (BL-717's ctx.branch precedent) so this one regex can serve all three
// without a passthrough/binary check on the engine text alone (BL-233).
const SELECTED_BY_SCENARIO_KIND = {
  status: {
    local: { classSubstring: 'VoiceEngineSelectorTest', nameSubstring: 'selector opens on the engine the bridge reports as in use - local' },
    openai: { classSubstring: 'VoiceEngineSelectorTest', nameSubstring: 'selector opens on the engine the bridge reports as in use - openai' },
  },
  refusal: {
    local: { classSubstring: 'VoiceEngineSelectorTest', nameSubstring: 'a refused choice shows the reason and leaves the working engine selected' },
  },
  relaunch: {
    openai: { classSubstring: 'VoiceEngineSelectorTest', nameSubstring: 'the chosen engine survives a relaunch because status always reflects the durable preference' },
  },
};

function registerSteps(registry) {
  // --- Background ------------------------------------------------------
  registry.defineScoped(
    /^Bubble is paired with a bridge$/,
    (ctx) => {
      ctx.repoRoot = repoRootFromHere();
      ctx.androidDir = path.join(ctx.repoRoot, 'android');
      if (!fs.existsSync(path.join(ctx.androidDir, 'gradlew'))) {
        throw new Error(`expected android/gradlew under ${ctx.androidDir}`);
      }
      const bridgeClient = path.join(ctx.androidDir, 'app', 'src', 'main', 'java', 'com', 'swarmforge', 'floatcompanion', 'BridgeClient.kt');
      if (!fs.existsSync(bridgeClient)) {
        throw new Error(`expected ${bridgeClient}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the voice-engine selector capability is enabled$/,
    (ctx) => {
      const configTs = path.join(
        ctx.repoRoot || repoRootFromHere(),
        'extension', 'src', 'bridge', 'letsTalkBubbleConfig.ts'
      );
      const source = fs.readFileSync(configTs, 'utf8');
      if (!/voiceEngineSwitch/.test(source)) {
        throw new Error(`expected a voiceEngineSwitch capability flag in ${configTs}`);
      }
      ctx.capabilityEnabled = true;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the voice-engine selector capability is disabled$/,
    (ctx) => {
      ctx.capabilityEnabled = false;
    },
    FEATURE_NAME
  );

  // --- Shared Given: which engine the bridge reports in use ------------
  registry.defineScoped(
    /^the bridge reports "([^"]+)" as the engine in use$/,
    (ctx, engine) => {
      ctx.engineInUse = engine;
      ctx.scenarioKind = 'status';
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the bridge reports "([^"]+)" as not serviceable because the OpenAI key is missing$/,
    (ctx, engine) => {
      ctx.unserviceableEngine = engine;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the bridge will refuse "([^"]+)" because the OpenAI key is missing$/,
    (ctx, engine) => {
      ctx.refusedEngine = engine;
      ctx.scenarioKind = 'refusal';
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^"([^"]+)" was chosen and accepted$/,
    (ctx, engine) => {
      ctx.relaunchEngine = engine;
      ctx.scenarioKind = 'relaunch';
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the bridge is unreachable$/,
    (ctx) => {
      ctx.bridgeUnreachable = true;
      ctx.scenarioKind = 'unreachable';
    },
    FEATURE_NAME
  );

  // --- Shared When -------------------------------------------------------
  registry.defineScoped(
    /^the Settings dialog is opened$/,
    (ctx) => {
      runJvmSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^Bubble is relaunched$/,
    (ctx) => {
      runJvmSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^"([^"]+)" is chosen in the Settings dialog$/,
    (ctx, engine) => {
      ctx.chosenEngine = engine;
      runJvmSuite(ctx);
    },
    FEATURE_NAME
  );

  // --- BL-864 selector-shows-the-engine-in-use-01 / refusal-03 / relaunch-05
  registry.defineScoped(
    /^the voice-engine selector shows "([^"]+)" as selected$/,
    (ctx, engine) => {
      const known = (SELECTED_BY_SCENARIO_KIND[ctx.scenarioKind] || {})[engine];
      if (!known) {
        throw new Error(
          `no known test for scenarioKind=${ctx.scenarioKind} engine="${engine}" — ` +
            `expected one of: ${JSON.stringify(SELECTED_BY_SCENARIO_KIND)}`
        );
      }
      assertKnownTestPassed(ctx, known.classSubstring, known.nameSubstring, `the voice-engine selector shows "${engine}" as selected`);
    },
    FEATURE_NAME
  );

  // --- BL-864 choosing-an-engine-writes-it-to-the-bridge-02 -------------
  registry.defineScoped(
    /^the bridge is asked to store "([^"]+)"$/,
    (ctx, engine) => {
      assertKnownTestPassed(
        ctx,
        'VoiceEngineSelectorTest',
        'an accepted choice updates the displayed selection and clears the message',
        `the bridge is asked to store "${engine}"`
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no credential is included in what is sent$/,
    (ctx) => {
      assertKnownTestPassed(
        ctx,
        'BridgeClientAudioEnginePreferenceBodyPropertyTest',
        'the request body never carries anything but the engine field, for any engine string',
        'no credential is included in what is sent'
      );
    },
    FEATURE_NAME
  );

  // --- BL-864 refusal-shows-a-reason-and-does-not-stick-03 --------------
  registry.defineScoped(
    /^the refusal reason is shown$/,
    (ctx) => {
      assertKnownTestPassed(
        ctx,
        'VoiceEngineSelectorTest',
        'a refused choice shows the reason and leaves the working engine selected',
        'the refusal reason is shown'
      );
    },
    FEATURE_NAME
  );

  // --- BL-864 unserviceable-engine-is-offered-disabled-04 ---------------
  registry.defineScoped(
    /^"([^"]+)" is offered as disabled$/,
    (ctx, engine) => {
      assertKnownTestPassed(
        ctx,
        'VoiceEngineSelectorTest',
        'an engine the host cannot serve is offered disabled, with its reason',
        `"${engine}" is offered as disabled`
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the reason the OpenAI key is missing is shown$/,
    (ctx) => {
      assertKnownTestPassed(
        ctx,
        'VoiceEngineSelectorTest',
        'an engine the host cannot serve is offered disabled, with its reason',
        'the reason the OpenAI key is missing is shown'
      );
    },
    FEATURE_NAME
  );

  // --- BL-864 selector-hidden-when-capability-off-06 --------------------
  registry.defineScoped(
    /^no voice-engine selector is shown$/,
    (ctx) => {
      assertKnownTestPassed(
        ctx,
        'VoiceEngineSelectorTest',
        'with the capability disabled the selector is hidden',
        'no voice-engine selector is shown'
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the other talk settings are still shown$/,
    (ctx) => {
      const layoutPath = path.join(
        ctx.androidDir || path.join(repoRootFromHere(), 'android'),
        'app', 'src', 'main', 'res', 'layout', 'dialog_settings.xml'
      );
      const xml = fs.readFileSync(layoutPath, 'utf8');
      for (const id of ['@+id/holdMusic', '@+id/mute', '@+id/volumeSeek']) {
        if (!xml.includes(id)) {
          throw new Error(`expected ${layoutPath} to still contain ${id} alongside the (conditionally hidden) voice-engine section`);
        }
      }
    },
    FEATURE_NAME
  );

  // --- BL-864 unreachable-bridge-does-not-fake-a-choice-07 --------------
  registry.defineScoped(
    /^the failure to reach the bridge is shown$/,
    (ctx) => {
      assertKnownTestPassed(
        ctx,
        'VoiceEngineSelectorTest',
        'an unreachable bridge shows the failure and does not report the tapped engine as selected',
        'the failure to reach the bridge is shown'
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the voice-engine selector does not show "([^"]+)" as selected$/,
    (ctx, engine) => {
      assertKnownTestPassed(
        ctx,
        'VoiceEngineSelectorTest',
        'an unreachable bridge shows the failure and does not report the tapped engine as selected',
        `the voice-engine selector does not show "${engine}" as selected`
      );
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
