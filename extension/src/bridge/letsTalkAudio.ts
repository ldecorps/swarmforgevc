// BL-696: server-side STT/TTS adapters for Let's Talk audio turns.
// Browser captures audio; the bridge host transcribes (and optionally
// synthesizes). Local mode uses whisper.cpp + browser speechSynthesis.

import type { SttResult, TtsResult } from '../tools/telegramFrontDeskBotCore';
import {
  parseLetsTalkSpeechLanguage,
  resolveTurnSpeechLanguage,
  speechLocaleForLanguage,
  type LetsTalkSpeechLanguage,
  type LetsTalkSpeechLanguageSetting,
} from './letsTalkCore';
import {
  letsTalkAudioEnvFromProcessEnv,
  parseLetsTalkAudioEngine,
  resolveWhisperCppConfig,
  transcribeWithWhisperCpp,
  type LetsTalkAudioEnv,
} from './letsTalkLocalAudio';

const OPENAI_STT_MODEL = 'whisper-1';
const OPENAI_TTS_MODEL = 'tts-1';
const OPENAI_TTS_VOICE = 'alloy';

export type TranscribeAudio = (bytes: Buffer, mimeType?: string) => Promise<SttResult>;
export type SynthesizeSpeech = (text: string) => Promise<TtsResult>;

export type OpenAiTranscriptionError = { code?: string; message?: string };

export function classifyTranscriptionResponse(
  status: number,
  ok: boolean,
  text: string | undefined,
  providerError?: OpenAiTranscriptionError
): SttResult {
  if (!ok) {
    if (status === 429 || providerError?.code === 'insufficient_quota') {
      return {
        kind: 'transient-failure',
        reason: 'OpenAI API quota exceeded — check billing and plan limits.',
      };
    }
    return status >= 400 && status < 500 ? { kind: 'unprocessable' } : { kind: 'transient-failure' };
  }
  return text ? { kind: 'ok', transcript: text } : { kind: 'unprocessable' };
}

export function extensionForMime(mimeType: string | undefined): string {
  if (!mimeType) {
    return 'audio.webm';
  }
  const lower = mimeType.toLowerCase();
  if (lower.includes('webm')) {
    return 'audio.webm';
  }
  if (lower.includes('ogg')) {
    return 'audio.ogg';
  }
  if (lower.includes('wav')) {
    return 'audio.wav';
  }
  if (lower.includes('mpeg') || lower.includes('mp3')) {
    return 'audio.mp3';
  }
  if (lower.includes('mp4') || lower.includes('m4a') || lower.includes('aac') || lower.includes('x-m4a') || lower.includes('caf')) {
    return 'audio.m4a';
  }
  return 'audio.webm';
}

export async function transcribeAudioBytes(
  openaiApiKey: string,
  bytes: Buffer,
  mimeType?: string,
  language?: LetsTalkSpeechLanguageSetting
): Promise<SttResult> {
  if (bytes.length === 0) {
    return { kind: 'unprocessable' };
  }
  try {
    const form = new FormData();
    const filename = extensionForMime(mimeType);
    const blobType = mimeType?.split(';')[0] || 'audio/webm';
    form.append('file', new Blob([bytes], { type: blobType }), filename);
    form.append('model', OPENAI_STT_MODEL);
    if (language && language !== 'en' && language !== 'auto') {
      form.append('language', language);
    }
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${openaiApiKey}` },
      body: form,
    });
    const json = (await res.json()) as { text?: string; error?: OpenAiTranscriptionError };
    return classifyTranscriptionResponse(res.status, res.ok, json?.text, json?.error);
  } catch {
    return { kind: 'transient-failure' };
  }
}

export async function synthesizeSpeechBytes(openaiApiKey: string, text: string): Promise<TtsResult> {
  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { authorization: `Bearer ${openaiApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_TTS_MODEL, voice: OPENAI_TTS_VOICE, input: text, response_format: 'opus' }),
    });
    if (!res.ok) {
      return { kind: 'failure' };
    }
    return { kind: 'ok', audio: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return { kind: 'failure' };
  }
}

export type LetsTalkAudioAdapters = {
  transcribeAudio?: TranscribeAudio;
  synthesizeSpeech?: SynthesizeSpeech;
  /** When true, the Mini App speaks replyText via speechSynthesis (no server TTS). */
  clientTts?: boolean;
  speechLanguage?: LetsTalkSpeechLanguageSetting;
  speechLocale?: string;
};

function speechSettingsFromEnv(env: LetsTalkAudioEnv): Pick<LetsTalkAudioAdapters, 'speechLanguage' | 'speechLocale'> {
  const speechLanguage = parseLetsTalkSpeechLanguage(env.speechLanguage);
  if (speechLanguage === 'auto') {
    return { speechLanguage };
  }
  return { speechLanguage, speechLocale: speechLocaleForLanguage(speechLanguage) };
}

function normalizeLetsTalkAudioEnv(envOrOpenAiKey: LetsTalkAudioEnv | string | undefined): LetsTalkAudioEnv {
  if (typeof envOrOpenAiKey === 'string' || envOrOpenAiKey === undefined) {
    return { openaiApiKey: envOrOpenAiKey };
  }
  return envOrOpenAiKey;
}

export function resolveLetsTalkAudioAdapters(
  envOrOpenAiKey: LetsTalkAudioEnv | string | undefined,
  overrides?: { transcribeAudio?: TranscribeAudio; synthesizeSpeech?: SynthesizeSpeech }
): LetsTalkAudioAdapters {
  if (overrides?.transcribeAudio || overrides?.synthesizeSpeech) {
    return {
      transcribeAudio: overrides.transcribeAudio,
      synthesizeSpeech: overrides.synthesizeSpeech,
      clientTts: overrides.synthesizeSpeech === undefined && overrides.transcribeAudio !== undefined,
      ...speechSettingsFromEnv(normalizeLetsTalkAudioEnv(envOrOpenAiKey)),
    };
  }
  const env = normalizeLetsTalkAudioEnv(envOrOpenAiKey);
  const speech = speechSettingsFromEnv(env);
  const engine = parseLetsTalkAudioEngine(env.engine);
  if (engine === 'local') {
    const whisper = resolveWhisperCppConfig(env);
    if (!whisper) {
      return {};
    }
    return {
      transcribeAudio: (bytes, mimeType) => transcribeWithWhisperCpp(whisper, bytes, mimeType),
      clientTts: true,
      ...speech,
    };
  }
  const openaiApiKey = env.openaiApiKey?.trim();
  if (!openaiApiKey) {
    return {};
  }
  return {
    transcribeAudio: (bytes, mimeType) =>
      transcribeAudioBytes(
        openaiApiKey,
        bytes,
        mimeType,
        speech.speechLanguage === 'auto' ? undefined : speech.speechLanguage
      ),
    synthesizeSpeech: (text) => synthesizeSpeechBytes(openaiApiKey, text),
    ...speech,
  };
}

export function resolveLetsTalkAudioAdaptersFromEnv(
  processEnv: NodeJS.ProcessEnv = process.env,
  overrides?: { transcribeAudio?: TranscribeAudio; synthesizeSpeech?: SynthesizeSpeech }
): LetsTalkAudioAdapters {
  return resolveLetsTalkAudioAdapters(letsTalkAudioEnvFromProcessEnv(processEnv), overrides);
}
