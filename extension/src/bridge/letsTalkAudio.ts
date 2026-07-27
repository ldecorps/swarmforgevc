// BL-696: server-side STT/TTS adapters for Let's Talk audio turns.
// Browser captures audio; the bridge host transcribes and synthesizes so
// Mini App CSP connect-src 'self' is never widened.

import type { SttResult, TtsResult } from '../tools/telegramFrontDeskBotCore';

const OPENAI_STT_MODEL = 'whisper-1';
const OPENAI_TTS_MODEL = 'tts-1';
const OPENAI_TTS_VOICE = 'alloy';

export type TranscribeAudio = (bytes: Buffer, mimeType?: string) => Promise<SttResult>;
export type SynthesizeSpeech = (text: string) => Promise<TtsResult>;

function classifyTranscriptionResponse(status: number, ok: boolean, text: string | undefined): SttResult {
  if (!ok) {
    return status >= 400 && status < 500 ? { kind: 'unprocessable' } : { kind: 'transient-failure' };
  }
  return text ? { kind: 'ok', transcript: text } : { kind: 'unprocessable' };
}

function extensionForMime(mimeType: string | undefined): string {
  if (!mimeType) {
    return 'audio.webm';
  }
  if (mimeType.includes('ogg')) {
    return 'audio.ogg';
  }
  if (mimeType.includes('wav')) {
    return 'audio.wav';
  }
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) {
    return 'audio.mp3';
  }
  return 'audio.webm';
}

export async function transcribeAudioBytes(openaiApiKey: string, bytes: Buffer, mimeType?: string): Promise<SttResult> {
  if (bytes.length === 0) {
    return { kind: 'unprocessable' };
  }
  try {
    const form = new FormData();
    form.append('file', new Blob([bytes]), extensionForMime(mimeType));
    form.append('model', OPENAI_STT_MODEL);
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${openaiApiKey}` },
      body: form,
    });
    const json = res.ok ? ((await res.json()) as { text?: string }) : undefined;
    return classifyTranscriptionResponse(res.status, res.ok, json?.text);
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

export function resolveLetsTalkAudioAdapters(
  openaiApiKey: string | undefined,
  overrides?: { transcribeAudio?: TranscribeAudio; synthesizeSpeech?: SynthesizeSpeech }
): { transcribeAudio?: TranscribeAudio; synthesizeSpeech?: SynthesizeSpeech } {
  if (overrides?.transcribeAudio || overrides?.synthesizeSpeech) {
    return {
      transcribeAudio: overrides.transcribeAudio,
      synthesizeSpeech: overrides.synthesizeSpeech,
    };
  }
  if (!openaiApiKey) {
    return {};
  }
  return {
    transcribeAudio: (bytes, mimeType) => transcribeAudioBytes(openaiApiKey, bytes, mimeType),
    synthesizeSpeech: (text) => synthesizeSpeechBytes(openaiApiKey, text),
  };
}
