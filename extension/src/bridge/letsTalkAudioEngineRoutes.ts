// BL-864: the HTTP surface that lets Bubble Settings read and write the
// Let's Talk voice-engine preference BL-863 already stores and resolves.
// Gated by the bubble-config `voiceEngineSwitch` capability flag (per the
// BL-862 epic's locked shape decision) — this module reads that config
// value directly; it does not wire BL-765's own (still-unbuilt)
// /lets-talk/bubble-config.json route.

import * as http from 'http';
import type { DeviceRegistry } from './deviceRegistry';
import { getLetsTalkBubbleConfig } from './letsTalkBubbleConfig';
import {
  currentLetsTalkAudioEngine,
  isEngineOnlyRecord,
  isPlainRecord,
  writeLetsTalkAudioEnginePreference,
} from './letsTalkAudioPreference';
import { isLetsTalkAudioEngineServiceable } from './letsTalkAudio';
import { letsTalkAudioEnvFromProcessEnv, type LetsTalkAudioEngine } from './letsTalkLocalAudio';

export const LETS_TALK_AUDIO_ENGINE_WRITE_MAX_BODY_BYTES = 4 * 1024;

export interface LetsTalkAudioEngineOptionStatus {
  serviceable: boolean;
  reason?: string;
}

export interface LetsTalkAudioEngineStatus {
  enabled: boolean;
  engine: LetsTalkAudioEngine;
  engines: Record<LetsTalkAudioEngine, LetsTalkAudioEngineOptionStatus>;
}

function optionStatus(check: { serviceable: true } | { serviceable: false; reason: string }): LetsTalkAudioEngineOptionStatus {
  return check.serviceable ? { serviceable: true } : { serviceable: false, reason: check.reason };
}

// The status a freshly-opened Settings dialog needs in one call: whether the
// selector should show at all, which engine is actually in use, and the
// serviceability (+ reason) of both options, so an unusable one can be
// offered disabled instead of failing after the tap.
export function buildLetsTalkAudioEngineStatus(
  targetPath: string,
  processEnv: NodeJS.ProcessEnv
): LetsTalkAudioEngineStatus {
  const env = letsTalkAudioEnvFromProcessEnv(processEnv);
  return {
    enabled: getLetsTalkBubbleConfig(targetPath, processEnv).features.voiceEngineSwitch,
    engine: currentLetsTalkAudioEngine(targetPath, processEnv),
    engines: {
      local: optionStatus(isLetsTalkAudioEngineServiceable(env, 'local')),
      openai: optionStatus(isLetsTalkAudioEngineServiceable(env, 'openai')),
    },
  };
}

export type LetsTalkAudioEngineWriteResult =
  | { success: true; engine: LetsTalkAudioEngine }
  | { success: false; reason: string };

// A choice is refused (never silently dropped) when the capability is off
// or the engine is not serviceable — the same serviceability check the
// status route reports, so a selector and its write path can never drift on
// what counts as usable. Locked human decision (BL-862): the phone sends an
// engine NAME only, so this never accepts (or looks at) anything else.
export function decideLetsTalkAudioEngineWrite(
  targetPath: string,
  processEnv: NodeJS.ProcessEnv,
  engine: LetsTalkAudioEngine
): LetsTalkAudioEngineWriteResult {
  if (!getLetsTalkBubbleConfig(targetPath, processEnv).features.voiceEngineSwitch) {
    return { success: false, reason: 'voice-engine selector is disabled' };
  }
  const env = letsTalkAudioEnvFromProcessEnv(processEnv);
  const serviceability = isLetsTalkAudioEngineServiceable(env, engine);
  if (!serviceability.serviceable) {
    return { success: false, reason: serviceability.reason };
  }
  const write = writeLetsTalkAudioEnginePreference(targetPath, { engine });
  if (!write.ok) {
    return { success: false, reason: write.reason };
  }
  return { success: true, engine };
}

export function isLetsTalkAudioEngineStatusRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'GET' && (url === '/lets-talk/audio-engine' || url.startsWith('/lets-talk/audio-engine?'));
}

export function isLetsTalkAudioEngineWriteRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'POST' && (url === '/lets-talk/audio-engine' || url.startsWith('/lets-talk/audio-engine?'));
}

// Reuses writeLetsTalkAudioEnginePreference's own shape check (BL-863) so a
// credential-carrying candidate can never be smuggled through this route
// under a differently-named key while the store's own check drifts apart.
export function isLetsTalkAudioEngineWriteRequestShape(value: unknown): value is { engine: LetsTalkAudioEngine } {
  return isPlainRecord(value) && isEngineOnlyRecord(value);
}

export interface LetsTalkAudioEngineRoute {
  matches: (req: http.IncomingMessage, url: string) => boolean;
  handle: (req: http.IncomingMessage, res: http.ServerResponse, targetPath: string, registry: DeviceRegistry) => void;
}

export function createLetsTalkAudioEngineRoutes(
  targetPath: string,
  requireAuth: (req: http.IncomingMessage, res: http.ServerResponse, registry: DeviceRegistry) => boolean,
  respond: (res: http.ServerResponse, status: number, body: unknown) => void,
  readValidatedBody: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    maxBytes: number,
    isShape: (value: unknown) => value is { engine: LetsTalkAudioEngine },
    shapeErrorReason: string
  ) => Promise<{ engine: LetsTalkAudioEngine } | null>
): LetsTalkAudioEngineRoute[] {
  return [
    {
      matches: isLetsTalkAudioEngineStatusRoute,
      handle: (req, res, _targetPath, registry) => {
        if (!requireAuth(req, res, registry)) {
          return;
        }
        respond(res, 200, { success: true, ...buildLetsTalkAudioEngineStatus(targetPath, process.env) });
      },
    },
    {
      matches: isLetsTalkAudioEngineWriteRoute,
      handle: (req, res, _targetPath, registry) => {
        if (!requireAuth(req, res, registry)) {
          return;
        }
        readValidatedBody(
          req,
          res,
          LETS_TALK_AUDIO_ENGINE_WRITE_MAX_BODY_BYTES,
          isLetsTalkAudioEngineWriteRequestShape,
          'expected a JSON body of {engine: "local"|"openai"}'
        ).then((value) => {
          if (!value) {
            return;
          }
          const result = decideLetsTalkAudioEngineWrite(targetPath, process.env, value.engine);
          respond(res, 200, result);
        });
      },
    },
  ];
}
