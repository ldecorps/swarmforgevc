const assert = require('node:assert/strict');
const {
  buildTranscriptionForm,
  classifyTranscriptionResponse,
  clientTtsFromOverrides,
  extensionForMime,
  isClientTranscriptionError,
  isLetsTalkAudioEngineServiceable,
  isTransientTranscriptionError,
  openAiTranscriptionLanguage,
  resolveLetsTalkAudioAdapters,
  resolveLetsTalkAudioAdaptersFromEnv,
  transcribeAudioBytes,
  synthesizeSpeechBytes,
} = require('../out/bridge/letsTalkAudio');

function installFetchCapture(handler) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls);
  };
  return {
    calls,
    restore() {
      global.fetch = original;
    },
  };
}

test('letsTalkAudio: compiled module exposes __esModule interop flag', () => {
  const mod = require('../out/bridge/letsTalkAudio');
  assert.equal(mod.__esModule, true);
  assert.equal(Object.getOwnPropertyDescriptor(mod, '__esModule')?.value, true);
});

test('letsTalkAudio: extensionForMime re-export is enumerable', () => {
  const mod = require('../out/bridge/letsTalkAudio');
  assert.equal(Object.getOwnPropertyDescriptor(mod, 'extensionForMime')?.enumerable, true);
});

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

test('letsTalkAudio: isTransientTranscriptionError detects quota signals independently', () => {
  assert.equal(isTransientTranscriptionError(429, undefined), true);
  assert.equal(isTransientTranscriptionError(400, { code: 'insufficient_quota' }), true);
  assert.equal(isTransientTranscriptionError(400, { code: 'invalid_request' }), false);
  assert.equal(isTransientTranscriptionError(503, undefined), false);
});

test('letsTalkAudio: isClientTranscriptionError covers 4xx only', () => {
  assert.equal(isClientTranscriptionError(399), false);
  assert.equal(isClientTranscriptionError(400), true);
  assert.equal(isClientTranscriptionError(404), true);
  assert.equal(isClientTranscriptionError(499), true);
  assert.equal(isClientTranscriptionError(500), false);
});

test('letsTalkAudio: clientTtsFromOverrides requires transcribe without synthesize', () => {
  const transcribe = async () => ({ kind: 'ok', transcript: 'x' });
  const synthesize = async () => ({ kind: 'ok', audio: Buffer.from('a') });
  assert.equal(clientTtsFromOverrides({}), false);
  assert.equal(clientTtsFromOverrides({ transcribeAudio: transcribe }), true);
  assert.equal(clientTtsFromOverrides({ synthesizeSpeech: synthesize }), false);
  assert.equal(
    clientTtsFromOverrides({ transcribeAudio: undefined, synthesizeSpeech: undefined }),
    false
  );
  assert.equal(
    clientTtsFromOverrides({ transcribeAudio: transcribe, synthesizeSpeech: synthesize }),
    false
  );
});

test('letsTalkAudio: openAiTranscriptionLanguage omits auto hint only', () => {
  assert.equal(openAiTranscriptionLanguage('auto'), undefined);
  assert.equal(openAiTranscriptionLanguage('fr'), 'fr');
  assert.equal(openAiTranscriptionLanguage('en'), 'en');
  assert.equal(openAiTranscriptionLanguage(undefined), undefined);
});

test('letsTalkAudio: classifyTranscriptionResponse maps HTTP outcomes', () => {
  assert.deepEqual(classifyTranscriptionResponse(200, true, 'hello'), { kind: 'ok', transcript: 'hello' });
  assert.deepEqual(classifyTranscriptionResponse(200, true, ''), { kind: 'unprocessable' });
  assert.deepEqual(classifyTranscriptionResponse(400, false, undefined), { kind: 'unprocessable' });
  assert.deepEqual(classifyTranscriptionResponse(401, false, undefined), { kind: 'unprocessable' });
  assert.deepEqual(classifyTranscriptionResponse(404, false, undefined), { kind: 'unprocessable' });
  assert.deepEqual(classifyTranscriptionResponse(500, false, undefined), { kind: 'transient-failure' });
  assert.deepEqual(classifyTranscriptionResponse(429, false, undefined), {
    kind: 'transient-failure',
    reason: 'OpenAI API quota exceeded — check billing and plan limits.',
  });
  assert.deepEqual(classifyTranscriptionResponse(429, false, undefined, { code: 'insufficient_quota' }), {
    kind: 'transient-failure',
    reason: 'OpenAI API quota exceeded — check billing and plan limits.',
  });
  assert.deepEqual(classifyTranscriptionResponse(400, false, undefined, { code: 'insufficient_quota' }), {
    kind: 'transient-failure',
    reason: 'OpenAI API quota exceeded — check billing and plan limits.',
  });
});

test('letsTalkAudio: buildTranscriptionForm sets file, model, and optional language', () => {
  const bytes = Buffer.from('audio-bytes');
  const defaultForm = buildTranscriptionForm(bytes, undefined, undefined);
  assert.equal(defaultForm.get('model'), 'whisper-1');
  const defaultFile = defaultForm.get('file');
  assert.ok(defaultFile instanceof Blob);
  assert.equal(defaultFile.type, 'audio/webm');
  assert.equal(defaultFile.size, bytes.length);

  const typedForm = buildTranscriptionForm(bytes, 'audio/ogg;codecs=opus', 'fr');
  const typedFile = typedForm.get('file');
  assert.equal(typedFile.type, 'audio/ogg');
  assert.equal(typedForm.get('language'), 'fr');
  assert.equal(buildTranscriptionForm(bytes, 'audio/wav', 'en').get('language'), null);
  assert.equal(buildTranscriptionForm(bytes, 'audio/wav', 'auto').get('language'), null);
  assert.equal(buildTranscriptionForm(bytes, 'audio/wav', undefined).get('language'), null);
});

test('letsTalkAudio: transcribeAudioBytes maps fetch responses', async () => {
  const capture = installFetchCapture(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ text: 'heard you' }),
  }));
  try {
    const result = await transcribeAudioBytes('key', Buffer.from('audio'));
    assert.deepEqual(result, { kind: 'ok', transcript: 'heard you' });
    assert.equal(capture.calls.length, 1);
    assert.equal(capture.calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(capture.calls[0].init.method, 'POST');
    assert.equal(capture.calls[0].init.headers.authorization, 'Bearer key');
    assert.ok(capture.calls[0].init.body instanceof FormData);
    assert.equal(capture.calls[0].init.body.get('model'), 'whisper-1');
  } finally {
    capture.restore();
  }
});

test('letsTalkAudio: transcribeAudioBytes maps fetch failures', async () => {
  const capture = installFetchCapture(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  try {
    const result = await transcribeAudioBytes('key', Buffer.from('audio'));
    assert.deepEqual(result, { kind: 'transient-failure' });
    assert.equal(capture.calls.length, 1);
  } finally {
    capture.restore();
  }
});

test('letsTalkAudio: transcribeAudioBytes surfaces OpenAI quota errors', async () => {
  const capture = installFetchCapture(async () => ({
    ok: false,
    status: 429,
    json: async () => ({
      error: { code: 'insufficient_quota', message: 'You exceeded your current quota' },
    }),
  }));
  try {
    const result = await transcribeAudioBytes('key', Buffer.from('audio'));
    assert.deepEqual(result, {
      kind: 'transient-failure',
      reason: 'OpenAI API quota exceeded — check billing and plan limits.',
    });
    assert.equal(capture.calls.length, 1);
  } finally {
    capture.restore();
  }
});

test('letsTalkAudio: transcribeAudioBytes rejects empty input without network', async () => {
  let fetchCalled = false;
  const capture = installFetchCapture(async () => {
    fetchCalled = true;
    return { ok: true, status: 200, json: async () => ({ text: 'nope' }) };
  });
  try {
    const result = await transcribeAudioBytes('key', Buffer.alloc(0));
    assert.deepEqual(result, { kind: 'unprocessable' });
    assert.equal(fetchCalled, false);
  } finally {
    capture.restore();
  }
});

test('letsTalkAudio: transcribeAudioBytes returns transient failure when fetch throws', async () => {
  const capture = installFetchCapture(async () => {
    throw new Error('offline');
  });
  try {
    const result = await transcribeAudioBytes('key', Buffer.from('audio'));
    assert.deepEqual(result, { kind: 'transient-failure' });
  } finally {
    capture.restore();
  }
});

test('letsTalkAudio: transcribeAudioBytes handles null json payload', async () => {
  const capture = installFetchCapture(async () => ({
    ok: true,
    status: 200,
    json: async () => null,
  }));
  try {
    const result = await transcribeAudioBytes('key', Buffer.from('audio'));
    assert.deepEqual(result, { kind: 'unprocessable' });
  } finally {
    capture.restore();
  }
});

test('letsTalkAudio: transcribeAudioBytes maps client errors when json is null', async () => {
  const capture = installFetchCapture(async () => ({
    ok: false,
    status: 400,
    json: async () => null,
  }));
  try {
    const result = await transcribeAudioBytes('key', Buffer.from('audio'));
    assert.deepEqual(result, { kind: 'unprocessable' });
  } finally {
    capture.restore();
  }
});

test('letsTalkAudio: transcribeAudioBytes handles missing json fields', async () => {
  const capture = installFetchCapture(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  }));
  try {
    const result = await transcribeAudioBytes('key', Buffer.from('audio'));
    assert.deepEqual(result, { kind: 'unprocessable' });
  } finally {
    capture.restore();
  }
});

test('letsTalkAudio: transcribeAudioBytes forwards non-auto language to OpenAI form', async () => {
  const capture = installFetchCapture(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ text: 'bonjour' }),
  }));
  try {
    const result = await transcribeAudioBytes('key', Buffer.from('audio'), 'audio/webm', 'fr');
    assert.deepEqual(result, { kind: 'ok', transcript: 'bonjour' });
    assert.equal(capture.calls[0].init.body.get('language'), 'fr');
  } finally {
    capture.restore();
  }
});

test('letsTalkAudio: resolveLetsTalkAudioAdapters honors overrides and reports a named failure on missing key', () => {
  const transcribe = async () => ({ kind: 'ok', transcript: 'x' });
  const synthesize = async () => ({ kind: 'ok', audio: Buffer.from('a') });
  const overridden = resolveLetsTalkAudioAdapters('key', { transcribeAudio: transcribe });
  assert.equal(overridden.kind, 'ok');
  assert.equal(overridden.adapters.transcribeAudio, transcribe);
  assert.equal(overridden.adapters.synthesizeSpeech, undefined);
  assert.equal(overridden.adapters.clientTts, true);

  const both = resolveLetsTalkAudioAdapters('key', {
    transcribeAudio: transcribe,
    synthesizeSpeech: synthesize,
  });
  assert.equal(both.adapters.clientTts, false);

  const synthOnly = resolveLetsTalkAudioAdapters('key', { synthesizeSpeech: synthesize });
  assert.equal(synthOnly.adapters.clientTts, false);

  // BL-863: no OpenAI key and no overrides — a named failure, never the old
  // silent `{}` that read as success with no adapters at all.
  const noKey = resolveLetsTalkAudioAdapters(undefined);
  assert.equal(noKey.kind, 'failure');
  assert.equal(noKey.engine, 'openai');
  assert.match(noKey.reason, /the OpenAI key/);
  const blankKey = resolveLetsTalkAudioAdapters('   ');
  assert.equal(blankKey.kind, 'failure');
  assert.equal(blankKey.engine, 'openai');

  const live = resolveLetsTalkAudioAdapters('key');
  assert.equal(live.kind, 'ok');
  assert.equal(live.engine, 'openai');
  assert.equal(typeof live.adapters.transcribeAudio, 'function');
  assert.equal(typeof live.adapters.synthesizeSpeech, 'function');
  assert.equal(live.adapters.clientTts, undefined);
});

test('letsTalkAudio: openai adapters invoke STT and TTS helpers', async () => {
  const capture = installFetchCapture(async (url) => {
    if (url.includes('/transcriptions')) {
      return { ok: true, status: 200, json: async () => ({ text: 'heard' }) };
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    };
  });
  try {
    const { adapters } = resolveLetsTalkAudioAdapters('key');
    assert.deepEqual(await adapters.transcribeAudio(Buffer.from('audio'), 'audio/webm'), {
      kind: 'ok',
      transcript: 'heard',
    });
    assert.deepEqual(await adapters.synthesizeSpeech('hello'), {
      kind: 'ok',
      audio: Buffer.from([1, 2, 3]),
    });
    assert.equal(capture.calls.length, 2);
    assert.match(capture.calls[1].url, /\/audio\/speech$/);
    assert.equal(capture.calls[1].init.method, 'POST');
    assert.equal(capture.calls[1].init.headers.authorization, 'Bearer key');
    assert.equal(capture.calls[1].init.headers['content-type'], 'application/json');
    const body = JSON.parse(capture.calls[1].init.body);
    assert.equal(body.model, 'tts-1');
    assert.equal(body.voice, 'alloy');
    assert.equal(body.input, 'hello');
    assert.equal(body.response_format, 'opus');
  } finally {
    capture.restore();
  }
});

test('letsTalkAudio: openai adapter omits language hint when speech is auto', async () => {
  const capture = installFetchCapture(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ text: 'hello' }),
  }));
  try {
    const { adapters } = resolveLetsTalkAudioAdaptersFromEnv({
      OPENAI_API_KEY: 'key',
      LETS_TALK_SPEECH_LANGUAGE: 'auto',
    });
    await adapters.transcribeAudio(Buffer.from('audio'), 'audio/webm');
    assert.equal(capture.calls[0].init.body.get('language'), null);
  } finally {
    capture.restore();
  }
});

test('letsTalkAudio: openai adapter forwards configured speech language', async () => {
  const capture = installFetchCapture(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ text: 'bonjour' }),
  }));
  try {
    const { adapters } = resolveLetsTalkAudioAdaptersFromEnv({
      OPENAI_API_KEY: 'key',
      LETS_TALK_SPEECH_LANGUAGE: 'fr',
    });
    await adapters.transcribeAudio(Buffer.from('audio'), 'audio/webm');
    assert.equal(capture.calls[0].init.body.get('language'), 'fr');
  } finally {
    capture.restore();
  }
});

test('letsTalkAudio: local engine wires whisper STT and client TTS only', async () => {
  const { kind, engine, adapters: local } = resolveLetsTalkAudioAdaptersFromEnv({
    LETS_TALK_AUDIO_ENGINE: 'local',
    WHISPER_MODEL_PATH: '/models/base.bin',
    WHISPER_CPP_BIN: '/bin/whisper-cli',
  });
  assert.equal(kind, 'ok');
  assert.equal(engine, 'local');
  assert.equal(typeof local.transcribeAudio, 'function');
  assert.equal(local.synthesizeSpeech, undefined);
  assert.equal(local.clientTts, true);
  assert.equal(local.speechLanguage, 'auto');
  assert.equal(local.speechLocale, undefined);
  const stt = await local.transcribeAudio(Buffer.from('audio'), 'audio/webm');
  assert.ok(stt && typeof stt.kind === 'string');
});

test('letsTalkAudio: local engine with French speech language', async () => {
  const { adapters: local } = resolveLetsTalkAudioAdaptersFromEnv({
    LETS_TALK_AUDIO_ENGINE: 'local',
    WHISPER_MODEL_PATH: '/models/base.bin',
    LETS_TALK_SPEECH_LANGUAGE: 'fr',
  });
  assert.equal(local.speechLanguage, 'fr');
  assert.equal(local.speechLocale, 'fr-FR');
  const stt = await local.transcribeAudio(Buffer.from('audio'), 'audio/webm');
  assert.ok(stt && typeof stt.kind === 'string');
});

test('letsTalkAudio: local engine without model path fails naming local and the missing engine', () => {
  const resolution = resolveLetsTalkAudioAdaptersFromEnv({ LETS_TALK_AUDIO_ENGINE: 'local' });
  assert.equal(resolution.kind, 'failure');
  assert.equal(resolution.engine, 'local');
  assert.match(resolution.reason, /the local engine/);
  assert.equal(resolution.adapters, undefined);
});

test('letsTalkAudio: synthesizeSpeechBytes returns failure on network error', async () => {
  const capture = installFetchCapture(async () => {
    throw new Error('offline');
  });
  try {
    const result = await synthesizeSpeechBytes('key', 'hello');
    assert.deepEqual(result, { kind: 'failure' });
    assert.equal(capture.calls.length, 1);
    assert.equal(capture.calls[0].url, 'https://api.openai.com/v1/audio/speech');
  } finally {
    capture.restore();
  }
});

test('letsTalkAudio: synthesizeSpeechBytes returns failure on non-ok HTTP', async () => {
  const capture = installFetchCapture(async () => ({
    ok: false,
    status: 500,
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
  try {
    const result = await synthesizeSpeechBytes('key', 'hello');
    assert.deepEqual(result, { kind: 'failure' });
    assert.equal(capture.calls[0].init.method, 'POST');
  } finally {
    capture.restore();
  }
});

test('letsTalkAudio: synthesizeSpeechBytes returns audio bytes on success', async () => {
  const capture = installFetchCapture(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => Uint8Array.from([9, 8, 7]).buffer,
  }));
  try {
    const result = await synthesizeSpeechBytes('key', 'hello');
    assert.deepEqual(result, { kind: 'ok', audio: Buffer.from([9, 8, 7]) });
    assert.equal(capture.calls[0].init.headers.authorization, 'Bearer key');
    const body = JSON.parse(capture.calls[0].init.body);
    assert.equal(body.model, 'tts-1');
    assert.equal(body.voice, 'alloy');
    assert.equal(body.input, 'hello');
    assert.equal(body.response_format, 'opus');
  } finally {
    capture.restore();
  }
});

test('letsTalkAudio: isLetsTalkAudioEngineServiceable reports openai serviceable with a key', () => {
  assert.deepEqual(isLetsTalkAudioEngineServiceable({ openaiApiKey: 'key' }, 'openai'), { serviceable: true });
});

test('letsTalkAudio: isLetsTalkAudioEngineServiceable reports openai not serviceable without a key', () => {
  const result = isLetsTalkAudioEngineServiceable({}, 'openai');
  assert.equal(result.serviceable, false);
  assert.match(result.reason, /the OpenAI key/);
});

test('letsTalkAudio: isLetsTalkAudioEngineServiceable reports local serviceable with a model path', () => {
  assert.deepEqual(isLetsTalkAudioEngineServiceable({ whisperModelPath: '/models/base.bin' }, 'local'), {
    serviceable: true,
  });
});

test('letsTalkAudio: isLetsTalkAudioEngineServiceable reports local not serviceable without a model path', () => {
  const result = isLetsTalkAudioEngineServiceable({}, 'local');
  assert.equal(result.serviceable, false);
  assert.match(result.reason, /the local engine/);
});
