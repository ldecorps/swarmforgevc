// BL-696: HTTP handlers for Let's Talk routes on the bridge host.
//
// This file is the POST write routes (turn, new-session) only. The GET
// JSON routes under /lets-talk/ — bubble-config.json, chiptunes.json, and
// (BL-825) the ui-bundle manifest — follow the established sibling-module
// pattern instead: each lives in its own letsTalk*.ts file and is wired
// into bridgeServer.ts's buildJsonRoutes, not here. See
// extension/src/bridge/letsTalkUiBundle.ts for the ui-bundle route.

import * as http from 'http';
import type { DeviceRegistry } from './deviceRegistry';
import type { SttResult } from '../tools/telegramFrontDeskBotCore';
import {
  decodeLetsTalkAudio,
  decideSttOutcome,
  formatLetsTalkAgentPrompt,
  isLetsTalkTurnRequestShape,
  resolveSpeakableReply,
  resolveTurnSpeechLanguage,
  speechLocaleForLanguage,
  sttFailureForOutcome,
  unprocessableAudioMessage,
  type LetsTalkSpeakableReply,
  type LetsTalkSpeechLanguageSetting,
} from './letsTalkCore';
import type { SynthesizeSpeech, TranscribeAudio, LetsTalkAudioResolution } from './letsTalkAudio';
import type { CursorBridgeAgentSessionDeps } from './cursorBridgeAgentSession';

export const LETS_TALK_TURN_MAX_BODY_BYTES = 8 * 1024 * 1024;

export interface LetsTalkRouteDeps {
  transcribeAudio?: TranscribeAudio;
  synthesizeSpeech?: SynthesizeSpeech;
  clientTts?: boolean;
  speechLanguage?: LetsTalkSpeechLanguageSetting;
  speechLocale?: string;
  agentSession: CursorBridgeAgentSessionDeps;
  onTurnSuccess?: (turn: LetsTalkTurnSuccess) => Promise<void> | void;
  // BL-863: when present, called fresh at the start of EVERY turn to resolve
  // transcribeAudio/synthesizeSpeech/clientTts instead of the static fields
  // above — this is what lets a stored engine preference (or its absence)
  // apply to the very next turn without a bridge restart. A `failure`
  // result ends the turn immediately with a reason naming the engine and
  // what is missing, never a silent no-op turn.
  resolveAudioForTurn?: () => LetsTalkAudioResolution;
}

export interface LetsTalkTurnSuccess {
  success: true;
  state: 'ready';
  transcript: string;
  replyText: string;
  replySpeechText?: string;
  replyAudioBase64?: string;
  clientTts?: boolean;
  speechLocale?: string;
  agentId: string;
}

type LetsTalkTurnFailure = { success: false; reason: string; recoverable: boolean; state: 'ready' | 'error' };

async function promptAgentForTranscript(
  transcript: string,
  deps: LetsTalkRouteDeps
): Promise<{ replyText: string; agentId: string } | LetsTalkTurnFailure> {
  const turnLanguage = resolveTurnSpeechLanguage(deps.speechLanguage ?? 'auto', transcript);
  try {
    const prompt = formatLetsTalkAgentPrompt(transcript, turnLanguage);
    const result = await deps.agentSession.promptAgent(prompt);
    return { replyText: result.replyText, agentId: result.agentId };
  } catch (err) {
    return {
      success: false,
      reason: err instanceof Error ? err.message : 'cursor agent error',
      recoverable: true,
      state: 'ready',
    };
  }
}

function clientTtsTurnSuccess(
  transcript: string,
  reply: LetsTalkSpeakableReply,
  agentId: string,
  speechLocale: string
): LetsTalkTurnSuccess {
  return {
    success: true,
    state: 'ready',
    transcript,
    replyText: reply.replyText,
    replySpeechText: reply.speechText,
    clientTts: true,
    speechLocale,
    agentId,
  };
}

async function promptAgentAndSynthesize(
  transcript: string,
  deps: LetsTalkRouteDeps
): Promise<LetsTalkTurnSuccess | LetsTalkTurnFailure> {
  const turnLanguage = resolveTurnSpeechLanguage(deps.speechLanguage ?? 'auto', transcript);
  const speechLocale = speechLocaleForLanguage(turnLanguage);
  const agentResult = await promptAgentForTranscript(transcript, deps);
  if ('success' in agentResult) {
    return agentResult;
  }
  const { agentId } = agentResult;
  // BL-717: never hand the phone a successful turn with nothing to say -
  // including when the raw reply is non-blank but reduces to nothing
  // pronounceable after speech-transform stripping (resolveSpeakableReply
  // covers both cases in one place, so client-TTS and server-TTS can't
  // drift out of sync on what counts as "no real speakable reply").
  const reply = resolveSpeakableReply(agentResult.replyText);
  if (!deps.synthesizeSpeech) {
    return deps.clientTts
      ? clientTtsTurnSuccess(transcript, reply, agentId, speechLocale)
      : { success: false, reason: 'text-to-speech is not configured', recoverable: true, state: 'ready' };
  }
  const tts = await deps.synthesizeSpeech(reply.speechText);
  if (tts.kind !== 'ok') {
    return { success: false, reason: 'text-to-speech failed', recoverable: true, state: 'ready' };
  }
  return {
    success: true,
    state: 'ready',
    transcript,
    replyText: reply.replyText,
    replyAudioBase64: tts.audio.toString('base64'),
    speechLocale,
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

function sttNotConfiguredFailure(): LetsTalkTurnFailure {
  return { success: false, reason: 'speech-to-text is not configured', recoverable: true, state: 'ready' };
}

// BL-863: resolves audio deps fresh for this turn when deps.resolveAudioForTurn
// is wired (the real bridge, never the static-mock BL-696 test path) — a
// resolution failure ends the turn immediately with its named reason.
function resolveTurnDeps(deps: LetsTalkRouteDeps): { deps: LetsTalkRouteDeps } | { failure: LetsTalkTurnFailure } {
  if (!deps.resolveAudioForTurn) {
    return { deps };
  }
  const resolution = deps.resolveAudioForTurn();
  if (resolution.kind === 'failure') {
    return { failure: { success: false, reason: resolution.reason, recoverable: true, state: 'ready' } };
  }
  return { deps: { ...deps, ...resolution.adapters } };
}

// Both the text-turn and audio-turn paths in processLetsTalkTurn end the
// same way: deliver a successful turn to onTurnSuccess, best-effort, without
// letting a mirror-delivery failure fail the turn itself. Extracted so
// processLetsTalkTurn carries this branching once instead of twice.
async function deliverTurnSuccessIfNeeded(
  result: LetsTalkTurnSuccess | LetsTalkTurnFailure,
  turnDeps: LetsTalkRouteDeps
): Promise<LetsTalkTurnSuccess | LetsTalkTurnFailure> {
  if (result.success && turnDeps.onTurnSuccess) {
    try {
      await turnDeps.onTurnSuccess(result);
    } catch {
      // Mirror delivery is best-effort and must not fail the turn itself.
    }
  }
  return result;
}

async function transcribeTurnAudio(
  bytes: Buffer,
  mimeType: string | undefined,
  deps: LetsTalkRouteDeps,
  sttAttempts?: { transientFailuresBeforeSuccess: number }
): Promise<{ transcript: string } | LetsTalkTurnFailure> {
  if (!deps.transcribeAudio) {
    return sttNotConfiguredFailure();
  }
  const stt = await deps.transcribeAudio(bytes, mimeType);
  if (sttAttempts && stt.kind === 'transient-failure') {
    sttAttempts.transientFailuresBeforeSuccess += 1;
  }
  const sttFailure = sttFailureForOutcome(decideSttOutcome(stt), stt);
  if (sttFailure) {
    return sttFailure;
  }
  return stt.kind === 'ok' ? { transcript: stt.transcript } : {
    success: false,
    reason: unprocessableAudioMessage(),
    recoverable: true,
    state: 'ready',
  };
}

async function handleLetsTalkAudioTurn(
  body: { audioBase64?: string; mimeType?: string },
  turnDeps: LetsTalkRouteDeps,
  sttAttempts?: { transientFailuresBeforeSuccess: number }
): Promise<LetsTalkTurnSuccess | LetsTalkTurnFailure> {
  const audioBase64 = body.audioBase64 ?? '';
  const bytes = decodeLetsTalkAudio(audioBase64);
  if (!bytes) {
    return {
      success: false,
      reason: unprocessableAudioMessage(),
      recoverable: true,
      state: 'ready',
    };
  }
  const sttResult = await transcribeTurnAudio(bytes, body.mimeType, turnDeps, sttAttempts);
  if ('success' in sttResult) {
    return sttResult;
  }
  const result = await promptAgentAndSynthesize(sttResult.transcript, turnDeps);
  return deliverTurnSuccessIfNeeded(result, turnDeps);
}

export async function processLetsTalkTurn(
  body: { audioBase64?: string; mimeType?: string; text?: string },
  deps: LetsTalkRouteDeps,
  sttAttempts?: { transientFailuresBeforeSuccess: number }
): Promise<LetsTalkTurnSuccess | LetsTalkTurnFailure> {
  const turnDepsResult = resolveTurnDeps(deps);
  if ('failure' in turnDepsResult) {
    return turnDepsResult.failure;
  }
  const turnDeps = turnDepsResult.deps;
  const textTurn = typeof body.text === 'string' ? body.text.trim() : '';
  if (textTurn.length > 0) {
    const result = await promptAgentAndSynthesize(textTurn, turnDeps);
    return deliverTurnSuccessIfNeeded(result, turnDeps);
  }
  return handleLetsTalkAudioTurn(body, turnDeps, sttAttempts);
}

export function createLetsTalkWriteRoutes(
  deps: LetsTalkRouteDeps,
  readValidatedBody: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    maxBytes: number,
    isShape: (value: unknown) => value is { audioBase64?: string; mimeType?: string; text?: string },
    shapeErrorReason: string
  ) => Promise<{ audioBase64?: string; mimeType?: string; text?: string } | null>,
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
    isShape: (value: unknown) => value is { audioBase64?: string; mimeType?: string; text?: string },
    shapeErrorReason: string
  ) => Promise<{ audioBase64?: string; mimeType?: string; text?: string } | null>,
  requireAuth: (req: http.IncomingMessage, res: http.ServerResponse, registry: DeviceRegistry) => boolean,
  respond: (res: http.ServerResponse, status: number, body: unknown) => void,
  sttAttempts?: { transientFailuresBeforeSuccess: number }
): (req: http.IncomingMessage, res: http.ServerResponse, _targetPath: string, registry: DeviceRegistry) => void {
  return (req, res, _targetPath, registry) => {
    if (!requireAuth(req, res, registry)) {
      return;
    }
    readBody(
      req,
      res,
      LETS_TALK_TURN_MAX_BODY_BYTES,
      isLetsTalkTurnRequestShape,
      'expected a JSON body of {audioBase64, mimeType?} or {text}'
    ).then(
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
