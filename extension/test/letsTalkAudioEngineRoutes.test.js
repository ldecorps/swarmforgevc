const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildLetsTalkAudioEngineStatus,
  decideLetsTalkAudioEngineWrite,
  isLetsTalkAudioEngineStatusRoute,
  isLetsTalkAudioEngineWriteRoute,
  isLetsTalkAudioEngineWriteRequestShape,
} = require('../out/bridge/letsTalkAudioEngineRoutes');
const { writeLetsTalkAudioEnginePreference, readLetsTalkAudioEnginePreference } = require('../out/bridge/letsTalkAudioPreference');

// BL-864: see specs/features/BL-864-bubble-settings-voice-engine-selector.feature
// for the human-readable scenarios this file exercises at the unit level —
// the bridge-side half only (the phone-side pure state machine is
// VoiceEngineSelector.kt, JVM-tested per the Bubble testability boundary).

function mkRoot() {
  const root = mkTmpDir('sfvc-lt-audio-engine-routes-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function disableCapability(root) {
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'lets-talk-bubble-config.json'),
    JSON.stringify({ schemaVersion: 1, revision: 'r1', features: { voiceEngineSwitch: false } })
  );
}

// BL-864 selector-shows-the-engine-in-use-01
test('buildLetsTalkAudioEngineStatus: reports the engine currently in use', () => {
  const root = mkRoot();
  writeLetsTalkAudioEnginePreference(root, { engine: 'openai' });
  const status = buildLetsTalkAudioEngineStatus(root, { OPENAI_API_KEY: 'sk-live' });
  assert.equal(status.engine, 'openai');
});

// BL-864 unserviceable-engine-is-offered-disabled-04
test('buildLetsTalkAudioEngineStatus: an engine missing its dependency is reported not serviceable, with a reason', () => {
  const root = mkRoot();
  const status = buildLetsTalkAudioEngineStatus(root, {});
  assert.equal(status.engines.openai.serviceable, false);
  assert.match(status.engines.openai.reason, /openai/i);
  assert.match(status.engines.openai.reason, /missing/i);
});

test('buildLetsTalkAudioEngineStatus: a configured engine is reported serviceable with no reason', () => {
  const root = mkRoot();
  const status = buildLetsTalkAudioEngineStatus(root, { OPENAI_API_KEY: 'sk-live' });
  assert.equal(status.engines.openai.serviceable, true);
  assert.equal(status.engines.openai.reason, undefined);
});

// BL-864 selector-hidden-when-capability-off-06
test('buildLetsTalkAudioEngineStatus: enabled reflects the voiceEngineSwitch capability flag', () => {
  const root = mkRoot();
  assert.equal(buildLetsTalkAudioEngineStatus(root, {}).enabled, true);
  disableCapability(root);
  assert.equal(buildLetsTalkAudioEngineStatus(root, {}).enabled, false);
});

// BL-864 choosing-an-engine-writes-it-to-the-bridge-02
test('decideLetsTalkAudioEngineWrite: a serviceable engine is accepted and persisted', () => {
  const root = mkRoot();
  const result = decideLetsTalkAudioEngineWrite(root, { OPENAI_API_KEY: 'sk-live' }, 'openai');
  assert.deepEqual(result, { success: true, engine: 'openai' });
  assert.deepEqual(readLetsTalkAudioEnginePreference(root), { kind: 'stored', engine: 'openai' });
});

// BL-864 refusal-shows-a-reason-and-does-not-stick-03
test('decideLetsTalkAudioEngineWrite: an unserviceable engine is refused with a reason, store unchanged', () => {
  const root = mkRoot();
  writeLetsTalkAudioEnginePreference(root, { engine: 'local' });
  const result = decideLetsTalkAudioEngineWrite(root, {}, 'openai');
  assert.equal(result.success, false);
  assert.match(result.reason, /openai/i);
  assert.match(result.reason, /missing/i);
  assert.deepEqual(readLetsTalkAudioEnginePreference(root), { kind: 'stored', engine: 'local' });
});

test('decideLetsTalkAudioEngineWrite: refused when the capability flag is off, even for a serviceable engine', () => {
  const root = mkRoot();
  disableCapability(root);
  const result = decideLetsTalkAudioEngineWrite(root, { OPENAI_API_KEY: 'sk-live' }, 'openai');
  assert.equal(result.success, false);
  assert.match(result.reason, /disabled/i);
  assert.deepEqual(readLetsTalkAudioEnginePreference(root), { kind: 'none' });
});

test('isLetsTalkAudioEngineStatusRoute: matches GET /lets-talk/audio-engine only', () => {
  assert.equal(isLetsTalkAudioEngineStatusRoute({ method: 'GET' }, '/lets-talk/audio-engine'), true);
  assert.equal(isLetsTalkAudioEngineStatusRoute({ method: 'GET' }, '/lets-talk/audio-engine?bearer=x'), true);
  assert.equal(isLetsTalkAudioEngineStatusRoute({ method: 'POST' }, '/lets-talk/audio-engine'), false);
  assert.equal(isLetsTalkAudioEngineStatusRoute({ method: 'GET' }, '/lets-talk/other'), false);
});

test('isLetsTalkAudioEngineWriteRoute: matches POST /lets-talk/audio-engine only', () => {
  assert.equal(isLetsTalkAudioEngineWriteRoute({ method: 'POST' }, '/lets-talk/audio-engine'), true);
  assert.equal(isLetsTalkAudioEngineWriteRoute({ method: 'GET' }, '/lets-talk/audio-engine'), false);
  assert.equal(isLetsTalkAudioEngineWriteRoute({ method: 'POST' }, '/lets-talk/other'), false);
});

test('isLetsTalkAudioEngineWriteRequestShape: accepts only an engine-only {engine: "local"|"openai"}', () => {
  assert.equal(isLetsTalkAudioEngineWriteRequestShape({ engine: 'local' }), true);
  assert.equal(isLetsTalkAudioEngineWriteRequestShape({ engine: 'openai' }), true);
  assert.equal(isLetsTalkAudioEngineWriteRequestShape({ engine: 'gpt5' }), false);
  assert.equal(isLetsTalkAudioEngineWriteRequestShape(null), false);
  assert.equal(isLetsTalkAudioEngineWriteRequestShape('openai'), false);
  assert.equal(isLetsTalkAudioEngineWriteRequestShape({}), false);
  assert.equal(isLetsTalkAudioEngineWriteRequestShape([]), false);
});

// BL-864 invariant 1 (credential never leaves the phone) defense-in-depth,
// mirroring BL-863's isEngineOnlyRecord: a candidate carrying anything
// beyond `engine` is refused wholesale, not stripped down to its engine
// field, so a credential can never ride along under a different key.
test('isLetsTalkAudioEngineWriteRequestShape: refuses a candidate carrying an extra field wholesale', () => {
  assert.equal(isLetsTalkAudioEngineWriteRequestShape({ engine: 'openai', openaiApiKey: 'sk-x' }), false);
  assert.equal(isLetsTalkAudioEngineWriteRequestShape({ engine: 'openai', extra: null }), false);
});
