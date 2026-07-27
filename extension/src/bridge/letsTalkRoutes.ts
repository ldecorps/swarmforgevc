// BL-696: HTTP handlers for Let's Talk routes on the bridge host.

import * as http from 'http';
import type { DeviceRegistry } from './deviceRegistry';
import type { SttResult } from '../tools/telegramFrontDeskBotCore';
import {
  decodeLetsTalkAudio,
  decideSttOutcome,
  isLetsTalkTurnRequestShape,
  replyTextForSpeechSynthesis,
  sttFailureForOutcome,
  unprocessableAudioMessage,
} from './letsTalkCore';
import type { SynthesizeSpeech, TranscribeAudio } from './letsTalkAudio';
import type { CursorBridgeAgentSessionDeps } from './cursorBridgeAgentSession';

export const LETS_TALK_TURN_MAX_BODY_BYTES = 8 * 1024 * 1024;

export interface LetsTalkRouteDeps {
  transcribeAudio?: TranscribeAudio;
  synthesizeSpeech?: SynthesizeSpeech;
  clientTts?: boolean;
  agentSession: CursorBridgeAgentSessionDeps;
}

export interface LetsTalkTurnSuccess {
  success: true;
  state: 'ready';
  transcript: string;
  replyText: string;
  replySpeechText?: string;
  replyAudioBase64?: string;
  clientTts?: boolean;
  agentId: string;
}

type LetsTalkTurnFailure = { success: false; reason: string; recoverable: boolean; state: 'ready' | 'error' };

async function promptAgentAndSynthesize(
  transcript: string,
  deps: LetsTalkRouteDeps
): Promise<LetsTalkTurnSuccess | LetsTalkTurnFailure> {
  let replyText: string;
  let agentId: string;
  try {
    const result = await deps.agentSession.promptAgent(transcript);
    replyText = result.replyText;
    agentId = result.agentId;
  } catch (err) {
    return {
      success: false,
      reason: err instanceof Error ? err.message : 'cursor agent error',
      recoverable: true,
      state: 'ready',
    };
  }
  if (!deps.synthesizeSpeech) {
    if (deps.clientTts) {
      return {
        success: true,
        state: 'ready',
        transcript,
        replyText,
        replySpeechText: replyTextForSpeechSynthesis(replyText),
        clientTts: true,
        agentId,
      };
    }
    return { success: false, reason: 'text-to-speech is not configured', recoverable: true, state: 'ready' };
  }
  const tts = await deps.synthesizeSpeech(replyTextForSpeechSynthesis(replyText));
  if (tts.kind !== 'ok') {
    return { success: false, reason: 'text-to-speech failed', recoverable: true, state: 'ready' };
  }
  return {
    success: true,
    state: 'ready',
    transcript,
    replyText,
    replyAudioBase64: tts.audio.toString('base64'),
    agentId,
  };
}

export function isLetsTalkPath(url: string): boolean {
  return url === '/lets-talk' || url.startsWith('/lets-talk?');
}

export function isLetsTalkTurnRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'POST' && (url === '/lets-talk/turn' || url.startsWith('/lets-talk/turn?'));
}

export function isLetsTalkNewSessionRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'POST' && (url === '/lets-talk/new-session' || url.startsWith('/lets-talk/new-session?'));
}

async function transcribeTurnAudio(
  bytes: Buffer,
  mimeType: string | undefined,
  deps: LetsTalkRouteDeps,
  sttAttempts?: { transientFailuresBeforeSuccess: number }
): Promise<{ transcript: string } | LetsTalkTurnFailure> {
  if (!deps.transcribeAudio) {
    return { success: false, reason: 'speech-to-text is not configured', recoverable: true, state: 'ready' };
  }
  const stt = await deps.transcribeAudio(bytes, mimeType);
  if (sttAttempts && stt.kind === 'transient-failure') {
    sttAttempts.transientFailuresBeforeSuccess += 1;
  }
  const sttFailure = sttFailureForOutcome(decideSttOutcome(stt), stt);
  if (sttFailure) {
    return sttFailure;
  }
  if (stt.kind !== 'ok') {
    return {
      success: false,
      reason: unprocessableAudioMessage(),
      recoverable: true,
      state: 'ready',
    };
  }
  return { transcript: stt.transcript };
}

export async function processLetsTalkTurn(
  body: { audioBase64: string; mimeType?: string },
  deps: LetsTalkRouteDeps,
  sttAttempts?: { transientFailuresBeforeSuccess: number }
): Promise<LetsTalkTurnSuccess | LetsTalkTurnFailure> {
  const bytes = decodeLetsTalkAudio(body.audioBase64);
  if (!bytes) {
    return {
      success: false,
      reason: unprocessableAudioMessage(),
      recoverable: true,
      state: 'ready',
    };
  }
  const sttResult = await transcribeTurnAudio(bytes, body.mimeType, deps, sttAttempts);
  if ('success' in sttResult) {
    return sttResult;
  }
  return promptAgentAndSynthesize(sttResult.transcript, deps);
}

export function createLetsTalkWriteRoutes(
  deps: LetsTalkRouteDeps,
  readValidatedBody: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    maxBytes: number,
    isShape: (value: unknown) => value is { audioBase64: string; mimeType?: string },
    shapeErrorReason: string
  ) => Promise<{ audioBase64: string; mimeType?: string } | null>,
  requireAuth: (req: http.IncomingMessage, res: http.ServerResponse, registry: DeviceRegistry) => boolean,
  respond: (res: http.ServerResponse, status: number, body: unknown) => void
): Array<{
  matches: (req: http.IncomingMessage, url: string) => boolean;
  handle: (req: http.IncomingMessage, res: http.ServerResponse, _targetPath: string, registry: DeviceRegistry) => void;
}> {
  return [
    {
      matches: isLetsTalkTurnRoute,
      handle: createLetsTalkTurnHandler(deps, readValidatedBody, requireAuth, respond),
    },
    {
      matches: isLetsTalkNewSessionRoute,
      handle: createLetsTalkNewSessionHandler(deps, requireAuth, respond),
    },
  ];
}

export function createLetsTalkTurnHandler(
  deps: LetsTalkRouteDeps,
  readBody: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    maxBytes: number,
    isShape: (value: unknown) => value is { audioBase64: string; mimeType?: string },
    shapeErrorReason: string
  ) => Promise<{ audioBase64: string; mimeType?: string } | null>,
  requireAuth: (req: http.IncomingMessage, res: http.ServerResponse, registry: DeviceRegistry) => boolean,
  respond: (res: http.ServerResponse, status: number, body: unknown) => void,
  sttAttempts?: { transientFailuresBeforeSuccess: number }
): (req: http.IncomingMessage, res: http.ServerResponse, _targetPath: string, registry: DeviceRegistry) => void {
  return (req, res, _targetPath, registry) => {
    if (!requireAuth(req, res, registry)) {
      return;
    }
    readBody(req, res, LETS_TALK_TURN_MAX_BODY_BYTES, isLetsTalkTurnRequestShape, 'expected a JSON body of {audioBase64, mimeType?}').then(
      async (value) => {
        if (!value) {
          return;
        }
        const result = await processLetsTalkTurn(value, deps, sttAttempts);
        respond(res, 200, result);
      }
    );
  };
}

export function createLetsTalkNewSessionHandler(
  deps: LetsTalkRouteDeps,
  requireAuth: (req: http.IncomingMessage, res: http.ServerResponse, registry: DeviceRegistry) => boolean,
  respond: (res: http.ServerResponse, status: number, body: unknown) => void
): (req: http.IncomingMessage, res: http.ServerResponse, _targetPath: string, registry: DeviceRegistry) => void {
  return (req, res, _targetPath, registry) => {
    if (!requireAuth(req, res, registry)) {
      return;
    }
    deps.agentSession.resetSession().then((result) => {
      respond(res, 200, { success: true, agentId: result.agentId ?? null });
    });
  };
}
