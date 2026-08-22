// BL-696: server-side STT/TTS adapters for Let's Talk audio turns.
// Browser captures audio; the bridge host transcribes (and optionally
// synthesizes). Local mode uses whisper.cpp + browser speechSynthesis.

import type { SttResult, TtsResult } from '../tools/telegramFrontDeskBotCore';
import {
  parseLetsTalkSpeechLanguage,
  resolveTurnSpeechLanguage,
  speechLocaleForLanguage,
  extensionForMime,
  type LetsTalkSpeechLanguage,
  type LetsTalkSpeechLanguageSetting,
} from './letsTalkCore';
import {
  letsTalkAudioEnvFromProcessEnv,
  parseLetsTalkAudioEngine,
  resolveWhisperCppConfig,
  transcribeWithWhisperCpp,
  type LetsTalkAudioEngine,
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
    return isTransientTranscriptionError(status, providerError)
      ? {
          kind: 'transient-failure',
          reason: 'OpenAI API quota exceeded — check billing and plan limits.',
        }
      : isClientTranscriptionError(status)
        ? { kind: 'unprocessable' }
        : { kind: 'transient-failure' };
  }
  return text ? { kind: 'ok', transcript: text } : { kind: 'unprocessable' };
}

export function isTransientTranscriptionError(status: number, providerError?: OpenAiTranscriptionError): boolean {
  return status === 429 || providerError?.code === 'insufficient_quota';
}

export function isClientTranscriptionError(status: number): boolean {
  return status >= 400 && status < 500;
}

export function buildTranscriptionForm(
  bytes: Buffer,
  mimeType: string | undefined,
  language?: LetsTalkSpeechLanguageSetting
): FormData {
  const form = new FormData();
  const filename = extensionForMime(mimeType);
  const blobType = mimeType?.split(';')[0] || 'audio/webm';
  form.append('file', new Blob([bytes], { type: blobType }), filename);
  form.append('model', OPENAI_STT_MODEL);
  if (language && language !== 'en' && language !== 'auto') {
    form.append('language', language);
  }
  return form;
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
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${openaiApiKey}` },
      body: buildTranscriptionForm(bytes, mimeType, language),
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

function adaptersFromOverrides(
  env: LetsTalkAudioEnv,
  overrides: { transcribeAudio?: TranscribeAudio; synthesizeSpeech?: SynthesizeSpeech }
): LetsTalkAudioAdapters {
  return {
    transcribeAudio: overrides.transcribeAudio,
    synthesizeSpeech: overrides.synthesizeSpeech,
    clientTts: clientTtsFromOverrides(overrides),
    ...speechSettingsFromEnv(env),
  };
}

export function clientTtsFromOverrides(overrides: {
  transcribeAudio?: TranscribeAudio;
  synthesizeSpeech?: SynthesizeSpeech;
}): boolean {
  return overrides.synthesizeSpeech === undefined && overrides.transcribeAudio !== undefined;
}

export function openAiTranscriptionLanguage(
  speechLanguage?: LetsTalkSpeechLanguageSetting
): LetsTalkSpeechLanguageSetting | undefined {
  return speechLanguage === 'auto' ? undefined : speechLanguage;
}

function adaptersFromLocalEngine(env: LetsTalkAudioEnv, speech: ReturnType<typeof speechSettingsFromEnv>): LetsTalkAudioAdapters | undefined {
  const whisper = resolveWhisperCppConfig(env);
  if (!whisper) {
    return undefined;
  }
  return {
    transcribeAudio: (bytes, mimeType) => transcribeWithWhisperCpp(whisper, bytes, mimeType),
    clientTts: true,
    ...speech,
  };
}

function adaptersFromOpenAi(
  env: LetsTalkAudioEnv,
  speech: ReturnType<typeof speechSettingsFromEnv>
): LetsTalkAudioAdapters | undefined {
  const openaiApiKey = env.openaiApiKey?.trim();
  if (!openaiApiKey) {
    return undefined;
  }
  return {
    transcribeAudio: (bytes, mimeType) =>
      transcribeAudioBytes(
        openaiApiKey,
        bytes,
        mimeType,
        openAiTranscriptionLanguage(speech.speechLanguage)
      ),
    synthesizeSpeech: (text) => synthesizeSpeechBytes(openaiApiKey, text),
    ...speech,
  };
}

// BL-863: a resolve either returns usable adapters or fails with a reason
// naming the engine and what is missing — never the old `?? {}` silent
// empty-adapter degradation (the exact failure mode the human forbade: an
// unusable engine that reads as success).
export type LetsTalkAudioResolution =
  | { kind: 'ok'; engine?: LetsTalkAudioEngine; adapters: LetsTalkAudioAdapters }
  | { kind: 'failure'; engine: LetsTalkAudioEngine; reason: string };

function missingLetsTalkAudioEngineReason(engine: LetsTalkAudioEngine): string {
  return engine === 'openai'
    ? 'openai audio engine unavailable: the OpenAI key is missing'
    : 'local audio engine unavailable: the local engine is missing';
}

function buildAdaptersForEngine(
  env: LetsTalkAudioEnv,
  engine: LetsTalkAudioEngine,
  speech: ReturnType<typeof speechSettingsFromEnv>
): LetsTalkAudioAdapters | undefined {
  return engine === 'local' ? adaptersFromLocalEngine(env, speech) : adaptersFromOpenAi(env, speech);
}

// BL-863: can be asked whether an engine is serviceable BEFORE it is chosen
// (e.g. so a future selector can disable an unusable option with a reason
// instead of offering a choice that will fail). Reuses the same
// adapter-building logic resolution itself uses, so the two can never drift
// on what counts as "configured".
export function isLetsTalkAudioEngineServiceable(
  env: LetsTalkAudioEnv,
  engine: LetsTalkAudioEngine
): { serviceable: true } | { serviceable: false; reason: string } {
  const adapters = buildAdaptersForEngine(env, engine, speechSettingsFromEnv(env));
  return adapters ? { serviceable: true } : { serviceable: false, reason: missingLetsTalkAudioEngineReason(engine) };
}

export function resolveLetsTalkAudioAdapters(
  envOrOpenAiKey: LetsTalkAudioEnv | string | undefined,
  overrides?: { transcribeAudio?: TranscribeAudio; synthesizeSpeech?: SynthesizeSpeech }
): LetsTalkAudioResolution {
  const env = normalizeLetsTalkAudioEnv(envOrOpenAiKey);
  if (overrides?.transcribeAudio || overrides?.synthesizeSpeech) {
    return { kind: 'ok', adapters: adaptersFromOverrides(env, overrides) };
  }
  const speech = speechSettingsFromEnv(env);
  const engine: LetsTalkAudioEngine = parseLetsTalkAudioEngine(env.engine) === 'local' ? 'local' : 'openai';
  const adapters = buildAdaptersForEngine(env, engine, speech);
  if (!adapters) {
    return { kind: 'failure', engine, reason: missingLetsTalkAudioEngineReason(engine) };
  }
  return { kind: 'ok', engine, adapters };
}

export function resolveLetsTalkAudioAdaptersFromEnv(
  processEnv: NodeJS.ProcessEnv = process.env,
  overrides?: { transcribeAudio?: TranscribeAudio; synthesizeSpeech?: SynthesizeSpeech }
): LetsTalkAudioResolution {
  return resolveLetsTalkAudioAdapters(letsTalkAudioEnvFromProcessEnv(processEnv), overrides);
}

export { extensionForMime } from './letsTalkCore';
