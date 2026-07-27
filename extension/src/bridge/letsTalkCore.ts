// BL-696: pure decisions for Let's Talk discrete audio turns on the console
// Mini App. No I/O — bridge routes and tests wire around these decisions.

import type { SttResult } from '../tools/telegramFrontDeskBotCore';

export const LETS_TALK_STT_RETRY_BUDGET = 3;

export type LetsTalkSttOutcome = 'prompt' | 'retry' | 'unprocessable';

export type LetsTalkTurnPhase = 'ready' | 'thinking' | 'speaking' | 'error';

export interface LetsTalkTurnRequest {
  audioBase64: string;
  mimeType?: string;
}

export function isLetsTalkTurnRequestShape(value: unknown): value is LetsTalkTurnRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  const audioBase64 = record.audioBase64;
  if (typeof audioBase64 !== 'string' || audioBase64.length === 0) {
    return false;
  }
  const mimeType = record.mimeType;
  return mimeType === undefined || typeof mimeType === 'string';
}

export function decodeLetsTalkAudio(audioBase64: string): Buffer | undefined {
  try {
    const bytes = Buffer.from(audioBase64, 'base64');
    return bytes.length > 0 ? bytes : undefined;
  } catch {
    return undefined;
  }
}

export function sttFailureForOutcome(
  outcome: LetsTalkSttOutcome,
  stt: SttResult
): { success: false; reason: string; recoverable: true; state: 'ready' | 'error' } | null {
  if (outcome === 'retry') {
    return {
      success: false,
      reason: 'speech-to-text is temporarily unavailable — try again',
      recoverable: true,
      state: 'error',
    };
  }
  if (outcome === 'unprocessable' || stt.kind !== 'ok') {
    return {
      success: false,
      reason: unprocessableAudioMessage(),
      recoverable: true,
      state: 'ready',
    };
  }
  return null;
}

export function decideSttOutcome(stt: SttResult): LetsTalkSttOutcome {
  if (stt.kind === 'ok') {
    return 'prompt';
  }
  if (stt.kind === 'transient-failure') {
    return 'retry';
  }
  return 'unprocessable';
}

export function sttRetryBudgetExhausted(attempts: number, budget: number = LETS_TALK_STT_RETRY_BUDGET): boolean {
  return attempts >= budget;
}

export function unprocessableAudioMessage(): string {
  return 'Could not transcribe the recording — the audio could not be decoded.';
}

export function extractCodeWordFromRememberPhrase(transcript: string): string | undefined {
  const match = transcript.match(/\bremember\s+the\s+code\s+word\s+(\w+)/i);
  return match?.[1];
}

export function mockAgentReplyForTranscript(transcript: string, rememberedCodeWord: string | undefined): string {
  const trimmed = transcript.trim();
  const lower = trimmed.toLowerCase();
  if (lower.includes('what was the code word')) {
    if (rememberedCodeWord) {
      return `The code word was ${rememberedCodeWord}.`;
    }
    return 'I do not have a code word stored in this session.';
  }
  const codeWord = extractCodeWordFromRememberPhrase(trimmed);
  if (codeWord) {
    return `Got it — I will remember the code word ${codeWord}.`;
  }
  return `You said: ${trimmed}`;
}
