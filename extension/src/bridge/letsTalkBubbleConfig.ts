import * as fs from 'fs';
import * as path from 'path';

export interface LetsTalkBubbleConfig {
  schemaVersion: number;
  revision: string;
  features: {
    textTurns: boolean;
    handsFree: boolean;
    holdMusic: boolean;
    playlist: boolean;
    newSession: boolean;
    pauseAll: boolean;
    bridgeBounceAutoSessionReset: boolean;
    // BL-864: gates the Bubble Settings Local/OpenAI voice-engine selector,
    // per the BL-862 epic's locked shape decision.
    voiceEngineSwitch: boolean;
  };
}

const DEFAULT_CONFIG: LetsTalkBubbleConfig = {
  schemaVersion: 1,
  revision: 'bundled-default',
  features: {
    textTurns: true,
    handsFree: true,
    holdMusic: true,
    playlist: true,
    newSession: true,
    pauseAll: true,
    bridgeBounceAutoSessionReset: true,
    voiceEngineSwitch: true,
  },
};

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseBubbleConfig(raw: unknown, fallbackRevision: string): LetsTalkBubbleConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const featuresRaw = record.features;
  if (!featuresRaw || typeof featuresRaw !== 'object' || Array.isArray(featuresRaw)) {
    return null;
  }
  const features = featuresRaw as Record<string, unknown>;
  return {
    schemaVersion: typeof record.schemaVersion === 'number' ? record.schemaVersion : 1,
    revision: typeof record.revision === 'string' && record.revision.trim() ? record.revision.trim() : fallbackRevision,
    features: {
      textTurns: coerceBoolean(features.textTurns, DEFAULT_CONFIG.features.textTurns),
      handsFree: coerceBoolean(features.handsFree, DEFAULT_CONFIG.features.handsFree),
      holdMusic: coerceBoolean(features.holdMusic, DEFAULT_CONFIG.features.holdMusic),
      playlist: coerceBoolean(features.playlist, DEFAULT_CONFIG.features.playlist),
      newSession: coerceBoolean(features.newSession, DEFAULT_CONFIG.features.newSession),
      pauseAll: coerceBoolean(features.pauseAll, DEFAULT_CONFIG.features.pauseAll),
      bridgeBounceAutoSessionReset: coerceBoolean(
        features.bridgeBounceAutoSessionReset,
        DEFAULT_CONFIG.features.bridgeBounceAutoSessionReset
      ),
      voiceEngineSwitch: coerceBoolean(features.voiceEngineSwitch, DEFAULT_CONFIG.features.voiceEngineSwitch),
    },
  };
}

function loadConfigFromFile(filePath: string, fallbackRevision: string): LetsTalkBubbleConfig | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parseBubbleConfig(parsed, fallbackRevision);
  } catch {
    return null;
  }
}

function boolFromEnv(value: string | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isLetsTalkBubbleConfigPath(url: string): boolean {
  const pathOnly = url.split('?', 1)[0];
  return pathOnly === '/lets-talk/bubble-config.json' || pathOnly === '/lets-talk/bubble-config';
}

/**
 * Bridge-served Bubble capability flags. New functionality can be enabled
 * without an APK rebuild, while rollback stays simple: switch to rollback file.
 */
export function getLetsTalkBubbleConfig(targetPath: string, env: NodeJS.ProcessEnv): LetsTalkBubbleConfig {
  const operatorDir = path.join(targetPath, '.swarmforge', 'operator');
  const primaryPath =
    env.LETS_TALK_BUBBLE_CONFIG_PATH ||
    path.join(operatorDir, 'lets-talk-bubble-config.json');
  const rollbackPath =
    env.LETS_TALK_BUBBLE_CONFIG_ROLLBACK_PATH ||
    path.join(operatorDir, 'lets-talk-bubble-config.rollback.json');
  const forceRollback = boolFromEnv(env.LETS_TALK_BUBBLE_FORCE_ROLLBACK);
  const disabled = boolFromEnv(env.LETS_TALK_BUBBLE_CONFIG_DISABLED);

  if (disabled) {
    return { ...DEFAULT_CONFIG, revision: `${DEFAULT_CONFIG.revision}-disabled` };
  }
  if (forceRollback) {
    return (
      loadConfigFromFile(rollbackPath, 'rollback') ??
      loadConfigFromFile(primaryPath, 'primary') ??
      DEFAULT_CONFIG
    );
  }
  return (
    loadConfigFromFile(primaryPath, 'primary') ??
    loadConfigFromFile(rollbackPath, 'rollback') ??
    DEFAULT_CONFIG
  );
}

export function getLetsTalkBubbleConfigJsonBody(targetPath: string, env: NodeJS.ProcessEnv): string {
  return JSON.stringify(getLetsTalkBubbleConfig(targetPath, env));
}
