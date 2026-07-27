const assert = require('node:assert/strict');
const {
  parseLetsTalkAudioEngine,
  resolveWhisperCppConfig,
  transcribeWithWhisperCpp,
} = require('../out/bridge/letsTalkLocalAudio');

test('letsTalkLocalAudio: parseLetsTalkAudioEngine accepts local and openai', () => {
  assert.equal(parseLetsTalkAudioEngine('local'), 'local');
  assert.equal(parseLetsTalkAudioEngine('OPENAI'), 'openai');
  assert.equal(parseLetsTalkAudioEngine(undefined), undefined);
  assert.equal(parseLetsTalkAudioEngine('bogus'), undefined);
});

test('letsTalkLocalAudio: resolveWhisperCppConfig requires model path', () => {
  assert.equal(resolveWhisperCppConfig({ whisperModelPath: '  ' }), undefined);
  assert.deepEqual(resolveWhisperCppConfig({ whisperModelPath: '/models/base.bin' }), {
    bin: 'whisper-cli',
    modelPath: '/models/base.bin',
    language: 'auto',
  });
  assert.deepEqual(
    resolveWhisperCppConfig({
      whisperModelPath: '/models/base.bin',
      speechLanguage: 'fr',
    }),
    { bin: 'whisper-cli', modelPath: '/models/base.bin', language: 'fr' }
  );
  assert.deepEqual(
    resolveWhisperCppConfig({
      whisperModelPath: '/models/base.bin',
      whisperCppBin: '/usr/bin/whisper',
      ffmpegBin: '/usr/bin/ffmpeg',
    }),
    { bin: '/usr/bin/whisper', modelPath: '/models/base.bin', ffmpegBin: '/usr/bin/ffmpeg', language: 'auto' }
  );
});

test('letsTalkLocalAudio: transcribeWithWhisperCpp returns transcript from whisper output file', async () => {
  const calls = [];
  const deps = {
    mkTempDir: async () => '/tmp/work',
    writeFile: async (filePath, data) => {
      calls.push(['write', filePath, data.length]);
    },
    readFile: async (filePath) => {
      calls.push(['read', filePath]);
      return 'hello operator\n';
    },
    exists: (filePath) => filePath.endsWith('whisper-out.txt'),
    rmDir: async (dirPath) => {
      calls.push(['rm', dirPath]);
    },
    execFile: async (file, args) => {
      calls.push(['exec', file, args.join(' ')]);
    },
  };
  const result = await transcribeWithWhisperCpp(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin' },
    Buffer.from('audio-bytes'),
    'audio/webm',
    deps
  );
  assert.deepEqual(result, { kind: 'ok', transcript: 'hello operator' });
  assert.ok(calls.some((c) => c[0] === 'exec' && c[1] === '/bin/whisper-cli'));
});

test('letsTalkLocalAudio: transcribeWithWhisperCpp retries via ffmpeg when direct decode fails', async () => {
  let whisperCalls = 0;
  const deps = {
    mkTempDir: async () => '/tmp/work',
    writeFile: async () => {},
    readFile: async () => 'converted text',
    exists: (filePath) => filePath.endsWith('whisper-out.txt'),
    rmDir: async () => {},
    execFile: async (file, args) => {
      if (file === '/bin/ffmpeg') {
        return;
      }
      whisperCalls += 1;
      if (whisperCalls === 1) {
        throw new Error('decode failed');
      }
    },
  };
  const result = await transcribeWithWhisperCpp(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin', ffmpegBin: '/bin/ffmpeg' },
    Buffer.from('audio-bytes'),
    'audio/webm',
    deps
  );
  assert.deepEqual(result, { kind: 'ok', transcript: 'converted text' });
  assert.equal(whisperCalls, 2);
});

test('letsTalkLocalAudio: does not delete work dir until ffmpeg retry whisper finishes', async () => {
  let whisperCalls = 0;
  let rmAtWhisperCall = 0;
  const deps = {
    mkTempDir: async () => '/tmp/work',
    writeFile: async () => {},
    readFile: async () => 'converted text',
    exists: (filePath) => {
      return whisperCalls >= 2 && filePath.endsWith('whisper-out.txt');
    },
    rmDir: async () => {
      rmAtWhisperCall = whisperCalls;
    },
    execFile: async (file, args) => {
      if (file === '/bin/ffmpeg') {
        return;
      }
      whisperCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
  };
  const result = await transcribeWithWhisperCpp(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin', ffmpegBin: '/bin/ffmpeg' },
    Buffer.from('audio-bytes'),
    'audio/webm',
    deps
  );
  assert.deepEqual(result, { kind: 'ok', transcript: 'converted text' });
  assert.equal(rmAtWhisperCall, 2, 'tmpdir must survive until the converted whisper pass completes');
});

test('letsTalkLocalAudio: whisper-cli receives language flag when configured', async () => {
  const calls = [];
  const deps = {
    mkTempDir: async () => '/tmp/work',
    writeFile: async () => {},
    readFile: async () => 'bonjour',
    exists: (filePath) => filePath.endsWith('whisper-out.txt'),
    rmDir: async () => {},
    execFile: async (file, args) => {
      calls.push(args);
    },
  };
  await transcribeWithWhisperCpp(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin', language: 'fr' },
    Buffer.from('audio-bytes'),
    'audio/webm',
    deps
  );
  assert.ok(calls.some((args) => args.includes('-l') && args.includes('fr')));
});
