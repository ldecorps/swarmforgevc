'use strict';

// BL-863: step handlers for "the bridge honors a stored voice-engine
// preference and refuses an unusable engine loudly"
// (specs/features/BL-863-voice-engine-preference-bridge.feature). Drives the
// real preference-store and resolution functions directly (not over HTTP —
// the feature's own scenarios are phrased at that level: "a preference is
// stored", "adapters are resolved for a turn", never "a request is sent to
// /lets-talk/...") — same posture bl696LetsTalkSteps.js uses for its own,
// HTTP-shaped scenarios, applied to this ticket's function-shaped ones.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  letsTalkAudioEnginePreferencePath,
  readLetsTalkAudioEnginePreference,
  writeLetsTalkAudioEnginePreference,
  resolveLetsTalkAudioForTurn,
} = require('../../../extension/out/bridge/letsTalkAudioPreference');
const { isLetsTalkAudioEngineServiceable } = require('../../../extension/out/bridge/letsTalkAudio');
const { letsTalkAudioEnvFromProcessEnv } = require('../../../extension/out/bridge/letsTalkLocalAudio');

const FEATURE = 'the bridge honors a stored voice-engine preference and refuses an unusable engine loudly';
const SERVICEABLE_WHISPER_MODEL_PATH = '/models/ggml-base.bin';
const OPENAI_TEST_KEY = 'sk-test-key';

function resolveTurn(ctx) {
  ctx.resolveCallCount = (ctx.resolveCallCount || 0) + 1;
  return resolveLetsTalkAudioForTurn(ctx.root, ctx.env);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function registerSteps(registry) {
  registry.defineScoped(
    /^a bridge host with a Let's Talk voice-engine preference store$/,
    (ctx) => {
      ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl863-'));
      fs.mkdirSync(path.join(ctx.root, '.swarmforge', 'operator'), { recursive: true });
      ctx.env = {};
    },
    FEATURE
  );

  registry.defineScoped(
    /^the host environment bootstraps the engine as "(local|openai)"$/,
    (ctx, engine) => {
      ctx.env.LETS_TALK_AUDIO_ENGINE = engine;
      // No scenario in this feature exercises "bootstrapped as local but
      // unserviceable" - scenario 4 tests that combination via a directly
      // stored preference instead, never via this bootstrap step - so
      // bootstrapping as local also configures a serviceable default here.
      if (engine === 'local') {
        ctx.env.WHISPER_MODEL_PATH = SERVICEABLE_WHISPER_MODEL_PATH;
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^the stored preference selects "(local|openai)"$/,
    (ctx, engine) => {
      const result = writeLetsTalkAudioEnginePreference(ctx.root, { engine });
      assert.equal(result.ok, true, `expected the preference write to succeed: ${JSON.stringify(result)}`);
    },
    FEATURE
  );

  registry.defineScoped(/^no preference has been stored$/, (ctx) => {
    assert.deepEqual(readLetsTalkAudioEnginePreference(ctx.root), { kind: 'none' });
  }, FEATURE);

  registry.defineScoped(/^the host has an OpenAI key$/, (ctx) => {
    ctx.env.OPENAI_API_KEY = OPENAI_TEST_KEY;
  }, FEATURE);

  registry.defineScoped(/^the host has no OpenAI key$/, (ctx) => {
    delete ctx.env.OPENAI_API_KEY;
  }, FEATURE);

  registry.defineScoped(/^the host has no local speech engine$/, (ctx) => {
    delete ctx.env.WHISPER_MODEL_PATH;
  }, FEATURE);

  registry.defineScoped(/^a turn has already been resolved$/, (ctx) => {
    // Both engines this scenario moves between (local then openai) must be
    // serviceable, so the "no restart needed" behavior under test is the
    // only thing that can make either turn fail.
    ctx.env.WHISPER_MODEL_PATH = SERVICEABLE_WHISPER_MODEL_PATH;
    ctx.env.OPENAI_API_KEY = OPENAI_TEST_KEY;
    const first = resolveTurn(ctx);
    assert.equal(first.resolution.kind, 'ok', `expected the first turn to resolve: ${JSON.stringify(first)}`);
    ctx.firstTurn = first;
  }, FEATURE);

  registry.defineScoped(
    /^the stored preference is changed to "(local|openai)"$/,
    (ctx, engine) => {
      const result = writeLetsTalkAudioEnginePreference(ctx.root, { engine });
      assert.equal(result.ok, true);
    },
    FEATURE
  );

  registry.defineScoped(/^adapters are resolved for a turn$/, (ctx) => {
    ctx.turnResult = resolveTurn(ctx);
  }, FEATURE);

  registry.defineScoped(/^the bridge was not restarted$/, (ctx) => {
    // No bridge process/handle is constructed at this function-level layer -
    // "not restarted" is proven here by both resolutions having run against
    // the SAME root/state in sequence, which is exactly what a real bridge's
    // per-turn resolver does across turns without a restart in between.
    assert.equal(
      ctx.resolveCallCount,
      2,
      'expected exactly two turn resolutions against the same running preference store'
    );
  }, FEATURE);

  registry.defineScoped(
    /^the "(local|openai)" engine is used$/,
    (ctx, engine) => {
      assert.equal(ctx.turnResult.resolution.kind, 'ok', `expected an ok resolution: ${JSON.stringify(ctx.turnResult)}`);
      assert.equal(ctx.turnResult.resolution.engine, engine);
    },
    FEATURE
  );

  registry.defineScoped(
    /^resolution fails with a reason naming "(local|openai)"$/,
    (ctx, engine) => {
      assert.equal(ctx.turnResult.resolution.kind, 'failure');
      assert.equal(ctx.turnResult.resolution.engine, engine);
      assert.match(ctx.turnResult.resolution.reason, new RegExp(engine, 'i'));
    },
    FEATURE
  );

  registry.defineScoped(
    /^the reason states (.+) is missing$/,
    (ctx, missingThing) => {
      assert.match(ctx.turnResult.resolution.reason, new RegExp(escapeRegExp(missingThing), 'i'));
      assert.match(ctx.turnResult.resolution.reason, /missing/i);
    },
    FEATURE
  );

  registry.defineScoped(/^no empty adapter set is returned$/, (ctx) => {
    assert.equal(ctx.turnResult.resolution.kind, 'failure');
    assert.equal('adapters' in ctx.turnResult.resolution, false);
  }, FEATURE);

  registry.defineScoped(
    /^the serviceability of "(local|openai)" is requested$/,
    (ctx, engine) => {
      const parsedEnv = letsTalkAudioEnvFromProcessEnv(ctx.env);
      ctx.serviceability = isLetsTalkAudioEngineServiceable(parsedEnv, engine);
    },
    FEATURE
  );

  registry.defineScoped(
    /^"(local|openai)" is reported (serviceable|not serviceable)$/,
    (ctx, _engine, verdict) => {
      assert.equal(ctx.serviceability.serviceable, verdict === 'serviceable');
    },
    FEATURE
  );

  registry.defineScoped(/^a preference carrying an OpenAI key is stored$/, (ctx) => {
    ctx.preferenceBeforeWrite = readLetsTalkAudioEnginePreference(ctx.root);
    ctx.writeResult = writeLetsTalkAudioEnginePreference(ctx.root, {
      engine: 'openai',
      openaiApiKey: 'sk-should-have-been-refused',
    });
  }, FEATURE);

  registry.defineScoped(/^the store refuses it$/, (ctx) => {
    assert.equal(ctx.writeResult.ok, false);
  }, FEATURE);

  registry.defineScoped(/^the stored preference is unchanged$/, (ctx) => {
    assert.deepEqual(readLetsTalkAudioEnginePreference(ctx.root), ctx.preferenceBeforeWrite);
  }, FEATURE);

  registry.defineScoped(/^the stored preference is unreadable$/, (ctx) => {
    const prefPath = letsTalkAudioEnginePreferencePath(ctx.root);
    fs.mkdirSync(path.dirname(prefPath), { recursive: true });
    fs.writeFileSync(prefPath, '{not json', 'utf8');
  }, FEATURE);

  registry.defineScoped(/^the unreadable preference is reported$/, (ctx) => {
    assert.equal(ctx.turnResult.unreadablePreference, true);
  }, FEATURE);
}

module.exports = { registerSteps };
