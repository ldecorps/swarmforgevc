const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  letsTalkAudioEnginePreferencePath,
  readLetsTalkAudioEnginePreference,
  writeLetsTalkAudioEnginePreference,
  resolveLetsTalkAudioForTurn,
} = require('../out/bridge/letsTalkAudioPreference');

// BL-863: durable Let's Talk voice-engine preference + per-turn resolution.
// See specs/features/BL-863-voice-engine-preference-bridge.feature for the
// human-readable scenarios this file exercises at the unit level.

function mkRoot() {
  return mkTmpDir('sfvc-lt-audio-pref-');
}

test('readLetsTalkAudioEnginePreference: no file yet reports none', () => {
  const root = mkRoot();
  assert.deepEqual(readLetsTalkAudioEnginePreference(root), { kind: 'none' });
});

test('writeLetsTalkAudioEnginePreference then read: round-trips the engine name', () => {
  const root = mkRoot();
  const result = writeLetsTalkAudioEnginePreference(root, { engine: 'openai' });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(readLetsTalkAudioEnginePreference(root), { kind: 'stored', engine: 'openai' });
});

test('writeLetsTalkAudioEnginePreference: refuses a candidate carrying a credential, store unchanged', () => {
  const root = mkRoot();
  const before = readLetsTalkAudioEnginePreference(root);
  const result = writeLetsTalkAudioEnginePreference(root, { engine: 'openai', openaiApiKey: 'sk-secret' });
  assert.equal(result.ok, false);
  assert.deepEqual(readLetsTalkAudioEnginePreference(root), before);
  assert.equal(fs.existsSync(letsTalkAudioEnginePreferencePath(root)), false);
});

test('writeLetsTalkAudioEnginePreference: refuses a credential-only candidate even with no engine field', () => {
  const root = mkRoot();
  const result = writeLetsTalkAudioEnginePreference(root, { openaiApiKey: 'sk-secret' });
  assert.equal(result.ok, false);
  assert.deepEqual(readLetsTalkAudioEnginePreference(root), { kind: 'none' });
});

test('writeLetsTalkAudioEnginePreference: refuses an invalid engine name, store unchanged', () => {
  const root = mkRoot();
  writeLetsTalkAudioEnginePreference(root, { engine: 'openai' });
  const result = writeLetsTalkAudioEnginePreference(root, { engine: 'gpt5' });
  assert.equal(result.ok, false);
  assert.deepEqual(readLetsTalkAudioEnginePreference(root), { kind: 'stored', engine: 'openai' });
});

test('writeLetsTalkAudioEnginePreference: on-disk file never carries anything but the engine name', () => {
  const root = mkRoot();
  writeLetsTalkAudioEnginePreference(root, { engine: 'local' });
  const raw = fs.readFileSync(letsTalkAudioEnginePreferencePath(root), 'utf8');
  assert.deepEqual(JSON.parse(raw), { engine: 'local' });
});

test('readLetsTalkAudioEnginePreference: corrupt JSON is reported unreadable, not thrown', () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(letsTalkAudioEnginePreferencePath(root)), { recursive: true });
  fs.writeFileSync(letsTalkAudioEnginePreferencePath(root), '{not json', 'utf8');
  assert.deepEqual(readLetsTalkAudioEnginePreference(root), { kind: 'unreadable' });
});

test('readLetsTalkAudioEnginePreference: valid JSON with an unrecognized engine is unreadable', () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(letsTalkAudioEnginePreferencePath(root)), { recursive: true });
  fs.writeFileSync(letsTalkAudioEnginePreferencePath(root), JSON.stringify({ engine: 'quantum' }), 'utf8');
  assert.deepEqual(readLetsTalkAudioEnginePreference(root), { kind: 'unreadable' });
});

test('resolveLetsTalkAudioForTurn: a stored preference wins over the env bootstrap', () => {
  const root = mkRoot();
  writeLetsTalkAudioEnginePreference(root, { engine: 'openai' });
  const { resolution, unreadablePreference } = resolveLetsTalkAudioForTurn(root, {
    LETS_TALK_AUDIO_ENGINE: 'local',
    OPENAI_API_KEY: 'sk-live',
  });
  assert.equal(unreadablePreference, false);
  assert.equal(resolution.kind, 'ok');
  assert.equal(resolution.engine, 'openai');
});

test('resolveLetsTalkAudioForTurn: with no preference stored the host environment still decides', () => {
  const root = mkRoot();
  const { resolution } = resolveLetsTalkAudioForTurn(root, {
    LETS_TALK_AUDIO_ENGINE: 'openai',
    OPENAI_API_KEY: 'sk-live',
  });
  assert.equal(resolution.kind, 'ok');
  assert.equal(resolution.engine, 'openai');
});

test('resolveLetsTalkAudioForTurn: a preference written between calls applies to the next call, no restart needed', () => {
  const root = mkRoot();
  writeLetsTalkAudioEnginePreference(root, { engine: 'local' });
  const env = {
    OPENAI_API_KEY: 'sk-live',
    WHISPER_MODEL_PATH: '/models/ggml-base.bin',
  };
  const first = resolveLetsTalkAudioForTurn(root, env);
  assert.equal(first.resolution.engine, 'local');

  writeLetsTalkAudioEnginePreference(root, { engine: 'openai' });
  const second = resolveLetsTalkAudioForTurn(root, env);
  assert.equal(second.resolution.engine, 'openai');
});

test('resolveLetsTalkAudioForTurn: openai selected with no key fails naming the engine and the missing key', () => {
  const root = mkRoot();
  writeLetsTalkAudioEnginePreference(root, { engine: 'openai' });
  const { resolution } = resolveLetsTalkAudioForTurn(root, {});
  assert.equal(resolution.kind, 'failure');
  assert.equal(resolution.engine, 'openai');
  assert.match(resolution.reason, /openai/i);
  assert.match(resolution.reason, /the OpenAI key/);
  assert.match(resolution.reason, /missing/i);
  assert.equal(resolution.adapters, undefined);
});

test('resolveLetsTalkAudioForTurn: local selected with no local engine fails naming the engine and the missing piece', () => {
  const root = mkRoot();
  writeLetsTalkAudioEnginePreference(root, { engine: 'local' });
  const { resolution } = resolveLetsTalkAudioForTurn(root, {});
  assert.equal(resolution.kind, 'failure');
  assert.equal(resolution.engine, 'local');
  assert.match(resolution.reason, /local/i);
  assert.match(resolution.reason, /the local engine/);
  assert.match(resolution.reason, /missing/i);
});

test('resolveLetsTalkAudioForTurn: an unreadable preference falls back to the host environment and is reported', () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(letsTalkAudioEnginePreferencePath(root)), { recursive: true });
  fs.writeFileSync(letsTalkAudioEnginePreferencePath(root), '{not json', 'utf8');
  const { resolution, unreadablePreference } = resolveLetsTalkAudioForTurn(root, {
    LETS_TALK_AUDIO_ENGINE: 'local',
    WHISPER_MODEL_PATH: '/models/ggml-base.bin',
  });
  assert.equal(unreadablePreference, true);
  assert.equal(resolution.kind, 'ok');
  assert.equal(resolution.engine, 'local');
});

test('resolveLetsTalkAudioForTurn: overrides bypass engine selection entirely and always succeed', () => {
  const root = mkRoot();
  writeLetsTalkAudioEnginePreference(root, { engine: 'openai' });
  const transcribeAudio = async () => ({ kind: 'ok', transcript: 'x' });
  const { resolution } = resolveLetsTalkAudioForTurn(root, {}, { transcribeAudio });
  assert.equal(resolution.kind, 'ok');
  assert.equal(resolution.adapters.transcribeAudio, transcribeAudio);
});
