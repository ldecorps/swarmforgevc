const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  letsTalkAudioEnvFromProcessEnv,
  parseLetsTalkAudioEngine,
  resolveWhisperCppConfig,
  transcribeWithWhisperCpp,
  defaultDeps,
  runWhisperOnce,
  convertToWav,
} = require('../out/bridge/letsTalkLocalAudio');

test('letsTalkLocalAudio: letsTalkAudioEnvFromProcessEnv maps env keys', () => {
  assert.deepEqual(
    letsTalkAudioEnvFromProcessEnv({
      LETS_TALK_AUDIO_ENGINE: 'local',
      OPENAI_API_KEY: 'sk-test',
      WHISPER_CPP_BIN: '/bin/whisper',
      WHISPER_MODEL_PATH: '/models/base.bin',
      FFMPEG_BIN: '/bin/ffmpeg',
      LETS_TALK_SPEECH_LANGUAGE: 'fr',
    }),
    {
      engine: 'local',
      openaiApiKey: 'sk-test',
      whisperCppBin: '/bin/whisper',
      whisperModelPath: '/models/base.bin',
      ffmpegBin: '/bin/ffmpeg',
      speechLanguage: 'fr',
    }
  );
});

test('letsTalkLocalAudio: parseLetsTalkAudioEngine accepts local and openai', () => {
  assert.equal(parseLetsTalkAudioEngine('local'), 'local');
  assert.equal(parseLetsTalkAudioEngine('OPENAI'), 'openai');
  assert.equal(parseLetsTalkAudioEngine('  local  '), 'local');
  assert.equal(parseLetsTalkAudioEngine('  OPENAI  '), 'openai');
  assert.equal(parseLetsTalkAudioEngine(undefined), undefined);
  assert.equal(parseLetsTalkAudioEngine('bogus'), undefined);
});

test('letsTalkLocalAudio: resolveWhisperCppConfig requires model path', () => {
  assert.equal(resolveWhisperCppConfig({}), undefined);
  assert.equal(resolveWhisperCppConfig({ whisperCppBin: '/bin/whisper' }), undefined);
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
  assert.deepEqual(
    resolveWhisperCppConfig({
      whisperModelPath: '/models/base.bin',
      whisperCppBin: '  /usr/bin/whisper  ',
      ffmpegBin: '  /usr/bin/ffmpeg  ',
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
    readFile: async (filePath, encoding) => {
      calls.push(['read', filePath, encoding]);
      return 'hello operator\n';
    },
    exists: (filePath) => filePath.endsWith('whisper-out.txt'),
    rmDir: async (dirPath) => {
      calls.push(['rm', dirPath]);
    },
    execFile: async (file, args) => {
      calls.push(['exec', file, args]);
    },
  };
  const result = await transcribeWithWhisperCpp(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin' },
    Buffer.from('audio-bytes'),
    'audio/webm',
    deps
  );
  assert.deepEqual(result, { kind: 'ok', transcript: 'hello operator' });
  const whisperCall = calls.find((c) => c[0] === 'exec' && c[1] === '/bin/whisper-cli');
  assert.ok(whisperCall);
  assert.deepEqual(whisperCall[2], [
    '-m',
    '/models/base.bin',
    '-f',
    '/tmp/work/audio.webm',
    '-otxt',
    '-of',
    '/tmp/work/whisper-out',
    '-nt',
    '-l',
    'auto',
  ]);
  assert.ok(calls.some((c) => c[0] === 'read' && c[2] === 'utf8'));
});

test('letsTalkLocalAudio: returns direct whisper result without ffmpeg retry', async () => {
  let whisperCalls = 0;
  let ffmpegCalls = 0;
  const deps = {
    mkTempDir: async () => '/tmp/work',
    writeFile: async () => {},
    readFile: async () => (whisperCalls === 1 ? 'direct transcript' : 'retry transcript'),
    exists: (filePath) => filePath.endsWith('whisper-out.txt'),
    rmDir: async () => {},
    execFile: async (file) => {
      if (file === '/bin/ffmpeg') {
        ffmpegCalls += 1;
        return;
      }
      whisperCalls += 1;
    },
  };
  const result = await transcribeWithWhisperCpp(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin', ffmpegBin: '/bin/ffmpeg' },
    Buffer.from('audio-bytes'),
    'audio/webm',
    deps
  );
  assert.deepEqual(result, { kind: 'ok', transcript: 'direct transcript' });
  assert.equal(whisperCalls, 1);
  assert.equal(ffmpegCalls, 0);
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

test('letsTalkLocalAudio: returns unprocessable when whisper fails and ffmpeg is unavailable', async () => {
  const deps = {
    mkTempDir: async () => '/tmp/work',
    writeFile: async () => {},
    readFile: async () => '',
    exists: () => false,
    rmDir: async () => {},
    execFile: async () => {
      throw new Error('whisper failed');
    },
  };
  const result = await transcribeWithWhisperCpp(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin' },
    Buffer.from('audio-bytes'),
    'audio/webm',
    deps
  );
  assert.equal(result.kind, 'transient-failure');
});

test('letsTalkLocalAudio: missing whisper output file is unprocessable', async () => {
  const deps = {
    mkTempDir: async () => '/tmp/work',
    writeFile: async () => {},
    readFile: async () => '',
    exists: () => false,
    rmDir: async () => {},
    execFile: async () => {},
  };
  const result = await transcribeWithWhisperCpp(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin' },
    Buffer.from('audio-bytes'),
    'audio/webm',
    deps
  );
  assert.deepEqual(result, { kind: 'unprocessable' });
});

test('letsTalkLocalAudio: empty audio bytes are unprocessable', async () => {
  const result = await transcribeWithWhisperCpp(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin' },
    Buffer.alloc(0)
  );
  assert.equal(result.kind, 'unprocessable');
});

test('letsTalkLocalAudio: whitespace-only whisper transcript is unprocessable', async () => {
  const deps = {
    mkTempDir: async () => '/tmp/work',
    writeFile: async () => {},
    readFile: async (_filePath, encoding) => {
      assert.equal(encoding, 'utf8');
      return '   \n\t  ';
    },
    exists: (filePath) => filePath.endsWith('whisper-out.txt'),
    rmDir: async () => {},
    execFile: async () => {},
  };
  const result = await runWhisperOnce(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin' },
    '/tmp/work/audio.webm',
    '/tmp/work',
    deps
  );
  assert.deepEqual(result, { kind: 'unprocessable' });
});

test('letsTalkLocalAudio: runWhisperOnce surfaces transient failure reason', async () => {
  const deps = {
    mkTempDir: async () => '/tmp/work',
    writeFile: async () => {},
    readFile: async () => '',
    exists: () => false,
    rmDir: async () => {},
    execFile: async () => {
      throw new Error('whisper failed');
    },
  };
  const result = await runWhisperOnce(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin' },
    '/tmp/work/audio.webm',
    '/tmp/work',
    deps
  );
  assert.deepEqual(result, {
    kind: 'transient-failure',
    reason: 'local speech-to-text engine failed',
  });
});

test('letsTalkLocalAudio: convertToWav without ffmpeg bin returns undefined', async () => {
  const deps = {
    mkTempDir: async () => '/tmp/work',
    writeFile: async () => {},
    readFile: async () => '',
    exists: () => false,
    rmDir: async () => {},
    execFile: async () => {},
  };
  const result = await convertToWav(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin' },
    '/tmp/work/audio.webm',
    '/tmp/work',
    deps
  );
  assert.equal(result, undefined);
});

test('letsTalkLocalAudio: convertToWav invokes ffmpeg with expected args', async () => {
  const calls = [];
  const deps = {
    mkTempDir: async () => '/tmp/work',
    writeFile: async () => {},
    readFile: async () => '',
    exists: () => false,
    rmDir: async () => {},
    execFile: async (file, args) => {
      calls.push([file, args]);
    },
  };
  const result = await convertToWav(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin', ffmpegBin: '/bin/ffmpeg' },
    '/tmp/work/audio.webm',
    '/tmp/work',
    deps
  );
  assert.equal(result, '/tmp/work/converted.wav');
  assert.deepEqual(calls, [
    [
      '/bin/ffmpeg',
      ['-i', '/tmp/work/audio.webm', '-ar', '16000', '-ac', '1', '-y', '/tmp/work/converted.wav'],
    ],
  ]);
});

test('letsTalkLocalAudio: convertToWav returns undefined when ffmpeg fails', async () => {
  const deps = {
    mkTempDir: async () => '/tmp/work',
    writeFile: async () => {},
    readFile: async () => '',
    exists: () => false,
    rmDir: async () => {},
    execFile: async () => {
      throw new Error('ffmpeg failed');
    },
  };
  const result = await convertToWav(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin', ffmpegBin: '/bin/ffmpeg' },
    '/tmp/work/audio.webm',
    '/tmp/work',
    deps
  );
  assert.equal(result, undefined);
});

test('letsTalkLocalAudio: returns transient failure when whisper fails and ffmpeg conversion fails', async () => {
  let whisperCalls = 0;
  const deps = {
    mkTempDir: async () => '/tmp/work',
    writeFile: async () => {},
    readFile: async () => 'retry text',
    exists: (filePath) => filePath.endsWith('whisper-out.txt'),
    rmDir: async () => {},
    execFile: async (file) => {
      if (file === '/bin/ffmpeg') {
        throw new Error('ffmpeg failed');
      }
      whisperCalls += 1;
      throw new Error('whisper failed');
    },
  };
  const result = await transcribeWithWhisperCpp(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin', ffmpegBin: '/bin/ffmpeg' },
    Buffer.from('audio-bytes'),
    'audio/webm',
    deps
  );
  assert.deepEqual(result, {
    kind: 'transient-failure',
    reason: 'local speech-to-text engine failed',
  });
  assert.equal(whisperCalls, 1, 'must not retry whisper when wav conversion fails after engine failure');
});

test('letsTalkLocalAudio: runWhisperOnce missing output file is unprocessable', async () => {
  const deps = {
    mkTempDir: async () => '/tmp/work',
    writeFile: async () => {},
    readFile: async () => '',
    exists: () => false,
    rmDir: async () => {},
    execFile: async () => {},
  };
  const result = await runWhisperOnce(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin' },
    '/tmp/work/audio.webm',
    '/tmp/work',
    deps
  );
  assert.deepEqual(result, { kind: 'unprocessable' });
});

test('letsTalkLocalAudio: returns unprocessable when whisper output is empty and ffmpeg conversion fails', async () => {
  let whisperCalls = 0;
  const deps = {
    mkTempDir: async () => '/tmp/work',
    writeFile: async () => {},
    readFile: async () => '',
    exists: (filePath) => filePath.endsWith('whisper-out.txt'),
    rmDir: async () => {},
    execFile: async (file, args) => {
      if (file === '/bin/ffmpeg') {
        throw new Error('ffmpeg failed');
      }
      whisperCalls += 1;
    },
  };
  const result = await transcribeWithWhisperCpp(
    { bin: '/bin/whisper-cli', modelPath: '/models/base.bin', ffmpegBin: '/bin/ffmpeg' },
    Buffer.from('audio-bytes'),
    'audio/webm',
    deps
  );
  assert.deepEqual(result, { kind: 'unprocessable' });
  assert.equal(whisperCalls, 1, 'must not retry whisper when ffmpeg conversion fails after empty transcript');
});

test('letsTalkLocalAudio: defaultDeps wires filesystem helpers', async () => {
  const deps = defaultDeps();
  assert.equal(typeof deps.mkTempDir, 'function');
  assert.equal(typeof deps.writeFile, 'function');
  assert.equal(typeof deps.readFile, 'function');
  assert.equal(typeof deps.exists, 'function');
  assert.equal(typeof deps.rmDir, 'function');
  assert.equal(typeof deps.execFile, 'function');

  const tmpDir = await deps.mkTempDir();
  assert.ok(tmpDir.includes('sfvc-whisper-'));
  const nestedDir = path.join(tmpDir, 'nested');
  fs.mkdirSync(nestedDir);
  const inputPath = path.join(nestedDir, 'probe.webm');
  await deps.writeFile(inputPath, Buffer.from('probe'));
  assert.equal(deps.exists(inputPath), true);
  assert.equal(await deps.readFile(inputPath, 'utf8'), 'probe');
  await deps.rmDir(tmpDir);
  assert.equal(fs.existsSync(tmpDir), false);
});

test('letsTalkLocalAudio: defaultDeps rmDir ignores missing paths', async () => {
  const deps = defaultDeps();
  await deps.rmDir(path.join(os.tmpdir(), 'sfvc-whisper-missing-' + Date.now()));
});

test('letsTalkLocalAudio: defaultDeps execFile works without options', async () => {
  const deps = defaultDeps();
  await deps.execFile(process.execPath, ['-e', 'process.exit(0)']);
});

test('letsTalkLocalAudio: defaultDeps execFile honors custom timeout', async () => {
  const deps = defaultDeps();
  await assert.rejects(
    () => deps.execFile(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeout: 50 }),
    (err) => err instanceof Error
  );
});

test('letsTalkLocalAudio: defaultDeps execFile rejects missing binaries', async () => {
  const deps = defaultDeps();
  await assert.rejects(
    () => deps.execFile('/definitely-not-a-real-binary-' + Date.now(), ['--help']),
    (err) => err instanceof Error
  );
});

test('letsTalkLocalAudio: importing the module exercises fs/os/path re-exports', () => {
  const mod = require('../out/bridge/letsTalkLocalAudio');
  assert.equal(typeof mod.transcribeWithWhisperCpp, 'function');
  assert.equal(typeof mod.defaultDeps, 'function');
  assert.ok(os.tmpdir().length > 0);
  assert.equal(path.basename(__filename), 'letsTalkLocalAudio.test.js');
  assert.equal(typeof fs.readFileSync, 'function');
});
