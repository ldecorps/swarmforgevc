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

export function extensionForMime(mimeType: string | undefined): string {
  if (!mimeType) {
    return 'audio.webm';
  }
  const lower = mimeType.toLowerCase();
  const rules: Array<{ match: (value: string) => boolean; ext: string }> = [
    { match: (v) => v.includes('webm'), ext: 'audio.webm' },
    { match: (v) => v.includes('ogg'), ext: 'audio.ogg' },
    { match: (v) => v.includes('wav'), ext: 'audio.wav' },
    { match: (v) => v.includes('mpeg') || v.includes('mp3'), ext: 'audio.mp3' },
    {
      match: (v) => v.includes('mp4') || v.includes('m4a') || v.includes('aac') || v.includes('x-m4a') || v.includes('caf'),
      ext: 'audio.m4a',
    },
  ];
  return rules.find((rule) => rule.match(lower))?.ext ?? 'audio.webm';
}

function sttRetryFailure(stt: SttResult): { success: false; reason: string; recoverable: true; state: 'error' } {
  return {
    success: false,
    reason:
      stt.kind === 'transient-failure' && stt.reason
        ? stt.reason
        : 'speech-to-text is temporarily unavailable — try again',
    recoverable: true,
    state: 'error',
  };
}

function sttUnprocessableFailure(stt: SttResult): { success: false; reason: string; recoverable: true; state: 'ready' } {
  return {
    success: false,
    reason: stt.kind !== 'ok' && stt.reason ? stt.reason : unprocessableAudioMessage(),
    recoverable: true,
    state: 'ready',
  };
}

export function sttFailureForOutcome(
  outcome: LetsTalkSttOutcome,
  stt: SttResult
): { success: false; reason: string; recoverable: true; state: 'ready' | 'error' } | null {
  if (outcome === 'retry') {
    return sttRetryFailure(stt);
  }
  if (outcome === 'unprocessable' || stt.kind !== 'ok') {
    return sttUnprocessableFailure(stt);
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

export type LetsTalkSpeechLanguage = 'en' | 'fr';
export type LetsTalkSpeechLanguageSetting = LetsTalkSpeechLanguage | 'auto';

const SPEECH_LANGUAGE_ALIASES: Array<{ matches: (lower: string) => boolean; value: LetsTalkSpeechLanguageSetting }> = [
  { matches: (lower) => lower === 'auto', value: 'auto' },
  { matches: (lower) => lower === 'fr' || lower === 'french' || lower.startsWith('fr-'), value: 'fr' },
  { matches: (lower) => lower === 'en' || lower === 'english' || lower.startsWith('en-'), value: 'en' },
];

export function parseLetsTalkSpeechLanguage(raw: string | undefined): LetsTalkSpeechLanguageSetting {
  if (!raw) {
    return 'auto';
  }
  const lower = raw.trim().toLowerCase();
  return SPEECH_LANGUAGE_ALIASES.find((rule) => rule.matches(lower))?.value ?? 'auto';
}

export function speechLocaleForLanguage(language: LetsTalkSpeechLanguage): string {
  return language === 'fr' ? 'fr-FR' : 'en-US';
}

function countLanguageWordHits(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

/** Heuristic per-turn language when LETS_TALK_SPEECH_LANGUAGE=auto. */
export function detectSpeechLanguageFromText(text: string): LetsTalkSpeechLanguage {
  const trimmed = text.trim();
  if (!trimmed) {
    return 'en';
  }
  if (/[àâäæçéèêëïîôùûüœ]/i.test(trimmed)) {
    return 'fr';
  }
  const frenchWord =
    /\b(bonjour|merci|salut|oui|non|comment|pourquoi|quand|avec|sans|dans|chez|très|aussi|être|avoir|vous|nous|ils|elles|cette|cet|ces|quoi|quel|quelle|quels|quelles)\b/i;
  const englishWord =
    /\b(hello|thanks|thank you|yes|no|what|when|where|why|how|with|without|the|this|that|these|those|you|your|they|their)\b/i;
  const frenchHits = countLanguageWordHits(trimmed, frenchWord);
  const englishHits = countLanguageWordHits(trimmed, englishWord);
  if (frenchHits > englishHits) {
    return 'fr';
  }
  if (englishHits > frenchHits) {
    return 'en';
  }
  return 'en';
}

export function resolveTurnSpeechLanguage(
  setting: LetsTalkSpeechLanguageSetting,
  transcript: string
): LetsTalkSpeechLanguage {
  if (setting === 'en' || setting === 'fr') {
    return setting;
  }
  return detectSpeechLanguageFromText(transcript);
}

const VOICE_PLAYBACK_RULE_EN =
  "[Let's Talk — reply in short plain sentences for voice playback; no markdown, file paths, or URLs.]";
const VOICE_PLAYBACK_RULE_FR =
  "[Let's Talk — réponds en français en phrases courtes pour la lecture vocale; pas de markdown, chemins de fichiers ni URL.]";

export function formatLetsTalkAgentPrompt(transcript: string, language: LetsTalkSpeechLanguage): string {
  const trimmed = transcript.trim();
  if (language === 'fr') {
    return `${VOICE_PLAYBACK_RULE_FR}\n\n${trimmed}`;
  }
  return `${VOICE_PLAYBACK_RULE_EN}\n\n${trimmed}`;
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

/** Strip markdown / markup so browser speechSynthesis reads natural prose. */
export function replyTextForSpeechSynthesis(text: string): string {
  let speech = text;
  speech = speech.replace(/```[\w-]*\n?([\s\S]*?)```/g, '$1');
  speech = speech.replace(/`([^`]+)`/g, '$1');
  speech = speech.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  speech = speech.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  speech = speech.replace(/<[^>]+>/g, ' ');
  speech = speech
    .split('\n')
    .filter((line) => !isMarkdownTableSeparatorLine(line))
    .map((line) => flattenMarkdownTableRow(line))
    .join('\n');
  speech = speech.replace(/^#{1,6}\s+/gm, '');
  speech = speech.replace(/^>\s?/gm, '');
  speech = speech.replace(/\*\*([^*]+)\*\*/g, '$1');
  speech = speech.replace(/\*([^*]+)\*/g, '$1');
  speech = speech.replace(/__([^_]+)__/g, '$1');
  speech = speech.replace(/_([^_]+)_/g, '$1');
  speech = speech.replace(/^\s*[-*+]\s+/gm, '');
  speech = speech.replace(/^\s*\d+\.\s+/gm, '');
  speech = speech.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, ' ');
  speech = speech.replace(/-{2,}/g, ' ');
  speech = speech.replace(/_{2,}/g, ' ');
  speech = speech.replace(/\*{2,}/g, ' ');
  speech = speech.replace(/[|#*_`~\[\]]/g, ' ');
  speech = speech.replace(/\s:\s/g, ' ');
  speech = speech.replace(/\n{3,}/g, '\n\n');
  speech = speech.replace(/[ \t]+\n/g, '\n');
  speech = speech.replace(/[ \t]{2,}/g, ' ');
  speech = sanitizeSlashesForSpeech(speech);
  speech = speech.replace(/[ \t]{2,}/g, ' ');
  return speech.trim();
}

/** Slashes in paths, URLs, and "and/or" are read aloud as "slash" by speechSynthesis. */
function sanitizeSlashesForSpeech(speech: string): string {
  let out = speech;
  out = out.replace(/\band\/or\b/gi, 'and or');
  out = out.replace(/https?:\/\/\S+/gi, '');
  out = out.replace(/\bwww\.\S+/gi, '');
  out = out.replace(/\b(\d+)\/(\d+)\b/g, '$1 over $2');
  out = out.replace(/\b[\w@$]*[A-Za-z][\w@$.-]*(?:\/[\w@$.-]+)+\b/g, (path) => path.replace(/\//g, ' '));
  out = out.replace(/\/([\w][\w-]*)/g, ' $1');
  out = out.replace(/\//g, ' ');
  return out;
}

function isMarkdownTableSeparatorLine(line: string): boolean {
  if (!line.includes('|') && !line.includes('-')) {
    return false;
  }
  return /^\s*\|?[\s|:-]+\|?\s*$/.test(line) && /-{3,}|:[-]+:/.test(line);
}

function flattenMarkdownTableRow(line: string): string {
  if (!line.includes('|')) {
    return line;
  }
  const cells = line
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0 && !/^:?-{3,}:?$/.test(cell));
  return cells.length > 0 ? cells.join(', ') : ' ';
}

// BL-697: optional hands-free listening — auto-start after playback, auto-stop on silence.
export const LETS_TALK_HANDS_FREE_STORAGE_KEY = 'lets-talk-hands-free';
export const LETS_TALK_HANDS_FREE_SILENCE_MS = 2500;
export const LETS_TALK_HANDS_FREE_POST_SPEECH_MS = 400;
export const LETS_TALK_HANDS_FREE_MAX_LISTEN_MS = 30000;
export const LETS_TALK_HANDS_FREE_SPEECH_LEVEL_THRESHOLD = 0.02;

export function parseHandsFreeEnabled(raw: string | null | undefined): boolean {
  return raw === '1' || raw === 'true';
}

export function serializeHandsFreeEnabled(enabled: boolean): string {
  return enabled ? '1' : '0';
}

export function shouldScheduleHandsFreeListen(input: {
  handsFreeEnabled: boolean;
  phase: LetsTalkTurnPhase;
  recording: boolean;
}): boolean {
  return input.handsFreeEnabled && input.phase === 'ready' && !input.recording;
}

export function shouldEndHandsFreeRecording(input: {
  handsFreeEnabled: boolean;
  recording: boolean;
  speechDetected: boolean;
  silenceMs: number;
  recordingMs: number;
  minRecordingMs: number;
  silenceThresholdMs: number;
}): boolean {
  if (!input.handsFreeEnabled || !input.recording) {
    return false;
  }
  if (input.recordingMs < input.minRecordingMs) {
    return false;
  }
  if (!input.speechDetected) {
    return false;
  }
  return input.silenceMs >= input.silenceThresholdMs;
}

export function shouldCancelHandsFreeRecordingNoSpeech(input: {
  handsFreeEnabled: boolean;
  recording: boolean;
  speechDetected: boolean;
  recordingMs: number;
  maxListenMs: number;
}): boolean {
  return (
    input.handsFreeEnabled &&
    input.recording &&
    !input.speechDetected &&
    input.recordingMs >= input.maxListenMs
  );
}

export function computeAudioLevelRms(samples: readonly number[]): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}

export function isSpeechAudioLevel(rms: number, threshold: number = LETS_TALK_HANDS_FREE_SPEECH_LEVEL_THRESHOLD): boolean {
  return rms >= threshold;
}
