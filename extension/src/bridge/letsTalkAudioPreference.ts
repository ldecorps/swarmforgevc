// BL-863: durable Let's Talk voice-engine preference (local/openai), stored
// bridge-side under .swarmforge/operator/, plus the per-turn resolution that
// makes a change apply without a bridge restart. Locked human decision: the
// preference carries an engine NAME only — writeLetsTalkAudioEnginePreference
// refuses anything else wholesale (no credential ever leaves the host, not
// even transiently through this store).
import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';
import {
  letsTalkAudioEnvFromProcessEnv,
  parseLetsTalkAudioEngine,
  type LetsTalkAudioEngine,
  type LetsTalkAudioEnv,
} from './letsTalkLocalAudio';
import {
  resolveLetsTalkAudioAdapters,
  type LetsTalkAudioResolution,
  type TranscribeAudio,
  type SynthesizeSpeech,
} from './letsTalkAudio';

export function letsTalkAudioEnginePreferencePath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'lets-talk-audio-engine-preference.json');
}

export type LetsTalkAudioEnginePreferenceRead =
  | { kind: 'stored'; engine: LetsTalkAudioEngine }
  | { kind: 'none' }
  | { kind: 'unreadable' };

export function readLetsTalkAudioEnginePreference(targetPath: string): LetsTalkAudioEnginePreferenceRead {
  const filePath = letsTalkAudioEnginePreferencePath(targetPath);
  if (!fs.existsSync(filePath)) {
    return { kind: 'none' };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    const engine = parsed?.engine;
    if (engine === 'local' || engine === 'openai') {
      return { kind: 'stored', engine };
    }
    return { kind: 'unreadable' };
  } catch {
    return { kind: 'unreadable' };
  }
}

export type LetsTalkAudioEnginePreferenceWrite = { ok: true } | { ok: false; reason: string };

export function isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
}

// Strict single-key allowlist: exactly {engine: 'local'|'openai'} and
// nothing else. A credential-carrying candidate (e.g. {engine, openaiApiKey})
// is refused WHOLESALE rather than stripped down to its engine field, so a
// caller can never smuggle a credential through under a differently-named
// key. Shared with BL-864's write route so both never drift on what counts
// as an acceptable body.
export function isEngineOnlyRecord(record: Record<string, unknown>): record is { engine: LetsTalkAudioEngine } {
  const keys = Object.keys(record);
  return keys.length === 1 && keys[0] === 'engine' && (record.engine === 'local' || record.engine === 'openai');
}

export function writeLetsTalkAudioEnginePreference(
  targetPath: string,
  candidate: unknown
): LetsTalkAudioEnginePreferenceWrite {
  if (!isPlainRecord(candidate)) {
    return { ok: false, reason: 'preference must be an object with only an engine field' };
  }
  if (!isEngineOnlyRecord(candidate)) {
    return {
      ok: false,
      reason: 'preference must carry only an engine name of "local" or "openai" — no other fields are accepted',
    };
  }
  atomicWrite(letsTalkAudioEnginePreferencePath(targetPath), JSON.stringify({ engine: candidate.engine }));
  return { ok: true };
}

// Shared by resolveLetsTalkAudioForTurn and BL-864's status route: a stored
// preference wins; with none stored (or an unreadable one) the host
// environment's LETS_TALK_AUDIO_ENGINE remains the bootstrap default. Reads
// the preference file fresh on every call — callers must invoke this from
// the turn path, not once at bridge startup, or a preference change will
// not take effect until a restart.
function selectLetsTalkAudioEngine(
  targetPath: string,
  processEnv: NodeJS.ProcessEnv
): { engine: LetsTalkAudioEngine; unreadablePreference: boolean } {
  const env = letsTalkAudioEnvFromProcessEnv(processEnv);
  const preference = readLetsTalkAudioEnginePreference(targetPath);
  const bootstrapEngine = parseLetsTalkAudioEngine(env.engine) ?? 'openai';
  const engine = preference.kind === 'stored' ? preference.engine : bootstrapEngine;
  return { engine, unreadablePreference: preference.kind === 'unreadable' };
}

// BL-864: the same engine a turn would resolve to (preference-over-bootstrap),
// without building STT/TTS adapters — what the Bubble Settings selector
// reports as "the engine actually in use" when the dialog opens.
export function currentLetsTalkAudioEngine(targetPath: string, processEnv: NodeJS.ProcessEnv): LetsTalkAudioEngine {
  return selectLetsTalkAudioEngine(targetPath, processEnv).engine;
}

export interface LetsTalkAudioTurnResolution {
  resolution: LetsTalkAudioResolution;
  /** True when a preference file exists but could not be read as a valid engine name. */
  unreadablePreference: boolean;
}

export function resolveLetsTalkAudioForTurn(
  targetPath: string,
  processEnv: NodeJS.ProcessEnv,
  overrides?: { transcribeAudio?: TranscribeAudio; synthesizeSpeech?: SynthesizeSpeech }
): LetsTalkAudioTurnResolution {
  const env = letsTalkAudioEnvFromProcessEnv(processEnv);
  const { engine, unreadablePreference } = selectLetsTalkAudioEngine(targetPath, processEnv);
  const effectiveEnv: LetsTalkAudioEnv = { ...env, engine };
  return {
    resolution: resolveLetsTalkAudioAdapters(effectiveEnv, overrides),
    unreadablePreference,
  };
}
