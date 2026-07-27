const assert = require('node:assert/strict');
const {
  classifyTranscriptionResponse,
  extensionForMime,
  resolveLetsTalkAudioAdapters,
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
});

test('letsTalkAudio: classifyTranscriptionResponse maps HTTP outcomes', () => {
  assert.deepEqual(classifyTranscriptionResponse(200, true, 'hello'), { kind: 'ok', transcript: 'hello' });
  assert.deepEqual(classifyTranscriptionResponse(200, true, ''), { kind: 'unprocessable' });
  assert.deepEqual(classifyTranscriptionResponse(400, false, undefined), { kind: 'unprocessable' });
  assert.deepEqual(classifyTranscriptionResponse(500, false, undefined), { kind: 'transient-failure' });
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
  assert.deepEqual(resolveLetsTalkAudioAdapters(undefined), {});
  const live = resolveLetsTalkAudioAdapters('key');
  assert.equal(typeof live.transcribeAudio, 'function');
  assert.equal(typeof live.synthesizeSpeech, 'function');
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
