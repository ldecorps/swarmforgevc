// BL-696 amendment: local whisper.cpp STT for Let's Talk (no cloud speech API).

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import type { SttResult } from '../tools/telegramFrontDeskBotCore';
import { extensionForMime } from './letsTalkCore';
import { parseLetsTalkSpeechLanguage, type LetsTalkSpeechLanguageSetting } from './letsTalkCore';

const execFileAsync = promisify(execFile);

export type LetsTalkAudioEngine = 'local' | 'openai';

export interface LetsTalkAudioEnv {
  engine?: string;
  openaiApiKey?: string;
  whisperCppBin?: string;
  whisperModelPath?: string;
  ffmpegBin?: string;
  speechLanguage?: string;
}

export interface WhisperCppConfig {
  bin: string;
  modelPath: string;
  ffmpegBin?: string;
  language?: LetsTalkSpeechLanguageSetting;
}

export interface WhisperCppDeps {
  mkTempDir: () => Promise<string>;
  writeFile: (filePath: string, data: Buffer) => Promise<void>;
  readFile: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  exists: (filePath: string) => boolean;
  rmDir: (dirPath: string) => Promise<void>;
  execFile: (file: string, args: string[], options?: { timeout?: number }) => Promise<void>;
}

export function parseLetsTalkAudioEngine(raw: string | undefined): LetsTalkAudioEngine | undefined {
  if (!raw) {
    return undefined;
  }
  const lower = raw.trim().toLowerCase();
  if (lower === 'local') {
    return 'local';
  }
  if (lower === 'openai') {
    return 'openai';
  }
  return undefined;
}

export function letsTalkAudioEnvFromProcessEnv(env: NodeJS.ProcessEnv): LetsTalkAudioEnv {
  return {
    engine: env.LETS_TALK_AUDIO_ENGINE,
    openaiApiKey: env.OPENAI_API_KEY,
    whisperCppBin: env.WHISPER_CPP_BIN,
    whisperModelPath: env.WHISPER_MODEL_PATH,
    ffmpegBin: env.FFMPEG_BIN,
    speechLanguage: env.LETS_TALK_SPEECH_LANGUAGE,
  };
}

export function resolveWhisperCppConfig(env: LetsTalkAudioEnv): WhisperCppConfig | undefined {
  const modelPath = env.whisperModelPath?.trim();
  if (!modelPath) {
    return undefined;
  }
  const bin = env.whisperCppBin?.trim() || 'whisper-cli';
  const ffmpegBin = env.ffmpegBin?.trim();
  const language = parseLetsTalkSpeechLanguage(env.speechLanguage);
  return { bin, modelPath, language, ...(ffmpegBin ? { ffmpegBin } : {}) };
}

export function defaultDeps(): WhisperCppDeps {
  return {
    mkTempDir: async () => fs.promises.mkdtemp(path.join(os.tmpdir(), 'sfvc-whisper-')),
    writeFile: (filePath, data) => fs.promises.writeFile(filePath, data),
    readFile: (filePath, encoding) => fs.promises.readFile(filePath, encoding),
    exists: (filePath) => fs.existsSync(filePath),
    rmDir: (dirPath) => fs.promises.rm(dirPath, { recursive: true, force: true }),
    execFile: async (file, args, options) => {
      await execFileAsync(file, args, { timeout: options?.timeout ?? 120_000 });
    },
  };
}

export async function runWhisperOnce(
  config: WhisperCppConfig,
  audioPath: string,
  workDir: string,
  deps: WhisperCppDeps
): Promise<SttResult> {
  const outBase = path.join(workDir, 'whisper-out');
  const args = ['-m', config.modelPath, '-f', audioPath, '-otxt', '-of', outBase, '-nt'];
  const lang = config.language ?? 'auto';
  args.push('-l', lang);
  try {
    await deps.execFile(config.bin, args);
  } catch {
    return { kind: 'transient-failure', reason: 'local speech-to-text engine failed' };
  }
  const txtPath = `${outBase}.txt`;
  if (!deps.exists(txtPath)) {
    return { kind: 'unprocessable' };
  }
  const text = (await deps.readFile(txtPath, 'utf8')).trim();
  return text ? { kind: 'ok', transcript: text } : { kind: 'unprocessable' };
}

export async function convertToWav(
  config: WhisperCppConfig,
  inputPath: string,
  workDir: string,
  deps: WhisperCppDeps
): Promise<string | undefined> {
  if (!config.ffmpegBin) {
    return undefined;
  }
  const wavPath = path.join(workDir, 'converted.wav');
  try {
    await deps.execFile(config.ffmpegBin, ['-i', inputPath, '-ar', '16000', '-ac', '1', '-y', wavPath]);
  } catch {
    return undefined;
  }
  return wavPath;
}

export async function transcribeWithWhisperCpp(
  config: WhisperCppConfig,
  bytes: Buffer,
  mimeType: string | undefined,
  deps: WhisperCppDeps = defaultDeps()
): Promise<SttResult> {
  if (bytes.length === 0) {
    return { kind: 'unprocessable' };
  }
  const tmpDir = await deps.mkTempDir();
  try {
    const filename = extensionForMime(mimeType);
    const inputPath = path.join(tmpDir, filename);
    await deps.writeFile(inputPath, bytes);
    const direct = await runWhisperOnce(config, inputPath, tmpDir, deps);
    if (direct.kind === 'ok') {
      return direct;
    }
        const wavPath = await convertToWav(config, inputPath, tmpDir, deps);
        if (!wavPath) {
          return direct;
        }
    return await runWhisperOnce(config, wavPath, tmpDir, deps);
  } finally {
    await deps.rmDir(tmpDir);
  }
}
