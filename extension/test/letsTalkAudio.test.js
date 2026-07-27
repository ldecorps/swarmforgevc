const assert = require('node:assert/strict');
const {
  classifyTranscriptionResponse,
  extensionForMime,
  resolveLetsTalkAudioAdapters,
  resolveLetsTalkAudioAdaptersFromEnv,
  transcribeAudioBytes,
  synthesizeSpeechBytes,
} = require('../out/bridge/letsTalkAudio');

test('letsTalkAudio: extensionForMime maps common mime types', () => {
  assert.equal(extensionForMime(undefined), 'audio.webm');
  assert.equal(extensionForMime('audio/ogg'), 'audio.ogg');
  assert.equal(extensionForMime('audio/wav'), 'audio.wav');
  assert.equal(extensionForMime('audio/mpeg'), 'audio.mp3');
  assert.equal(extensionForMime('audio/mp3'), 'audio.mp3');
  assert.equal(extensionForMime('audio/webm;codecs=opus'), 'audio.webm');
  assert.equal(extensionForMime('audio/mp4'), 'audio.m4a');
  assert.equal(extensionForMime('audio/aac'), 'audio.m4a');
  assert.equal(extensionForMime('audio/x-m4a'), 'audio.m4a');
});

test('letsTalkAudio: classifyTranscriptionResponse maps HTTP outcomes', () => {
  assert.deepEqual(classifyTranscriptionResponse(200, true, 'hello'), { kind: 'ok', transcript: 'hello' });
  assert.deepEqual(classifyTranscriptionResponse(200, true, ''), { kind: 'unprocessable' });
  assert.deepEqual(classifyTranscriptionResponse(400, false, undefined), { kind: 'unprocessable' });
  assert.deepEqual(classifyTranscriptionResponse(500, false, undefined), { kind: 'transient-failure' });
  assert.deepEqual(classifyTranscriptionResponse(429, false, undefined, { code: 'insufficient_quota' }), {
    kind: 'transient-failure',
    reason: 'OpenAI API quota exceeded — check billing and plan limits.',
  });
});

test('letsTalkAudio: transcribeAudioBytes maps fetch responses', async () => {
  const original = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ text: 'heard you' }),
  });
  try {
    const result = await transcribeAudioBytes('key', Buffer.from('audio'));
    assert.deepEqual(result, { kind: 'ok', transcript: 'heard you' });
  } finally {
    global.fetch = original;
  }
});

test('letsTalkAudio: transcribeAudioBytes maps fetch failures', async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  try {
    const result = await transcribeAudioBytes('key', Buffer.from('audio'));
    assert.deepEqual(result, { kind: 'transient-failure' });
  } finally {
    global.fetch = original;
  }
});

test('letsTalkAudio: transcribeAudioBytes surfaces OpenAI quota errors', async () => {
  const original = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({
      error: { code: 'insufficient_quota', message: 'You exceeded your current quota' },
    }),
  });
  try {
    const result = await transcribeAudioBytes('key', Buffer.from('audio'));
    assert.deepEqual(result, {
      kind: 'transient-failure',
      reason: 'OpenAI API quota exceeded — check billing and plan limits.',
    });
  } finally {
    global.fetch = original;
  }
});

test('letsTalkAudio: transcribeAudioBytes rejects empty input without network', async () => {
  const result = await transcribeAudioBytes('key', Buffer.alloc(0));
  assert.deepEqual(result, { kind: 'unprocessable' });
});

test('letsTalkAudio: resolveLetsTalkAudioAdapters honors overrides and missing key', () => {
  const transcribe = async () => ({ kind: 'ok', transcript: 'x' });
  const synthesize = async () => ({ kind: 'ok', audio: Buffer.from('a') });
  const overridden = resolveLetsTalkAudioAdapters('key', { transcribeAudio: transcribe });
  assert.equal(overridden.transcribeAudio, transcribe);
  assert.equal(overridden.synthesizeSpeech, undefined);
  assert.equal(overridden.clientTts, true);
  assert.deepEqual(resolveLetsTalkAudioAdapters(undefined), {});
  const live = resolveLetsTalkAudioAdapters('key');
  assert.equal(typeof live.transcribeAudio, 'function');
  assert.equal(typeof live.synthesizeSpeech, 'function');
  assert.equal(live.clientTts, undefined);
});

test('letsTalkAudio: local engine wires whisper STT and client TTS only', () => {
  const local = resolveLetsTalkAudioAdaptersFromEnv({
    LETS_TALK_AUDIO_ENGINE: 'local',
    WHISPER_MODEL_PATH: '/models/base.bin',
    WHISPER_CPP_BIN: '/bin/whisper-cli',
  });
  assert.equal(typeof local.transcribeAudio, 'function');
  assert.equal(local.synthesizeSpeech, undefined);
  assert.equal(local.clientTts, true);
});

test('letsTalkAudio: local engine without model path is empty', () => {
  assert.deepEqual(resolveLetsTalkAudioAdaptersFromEnv({ LETS_TALK_AUDIO_ENGINE: 'local' }), {});
});

test('letsTalkAudio: synthesizeSpeechBytes returns failure on network error', async () => {
  const original = global.fetch;
  global.fetch = async () => {
    throw new Error('offline');
  };
  try {
    const result = await synthesizeSpeechBytes('key', 'hello');
    assert.deepEqual(result, { kind: 'failure' });
  } finally {
    global.fetch = original;
  }
});
