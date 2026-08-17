import * as fs from 'fs';
import * as path from 'path';
import { boolFromEnv } from '../util/envFlag';

/**
 * BL-825 slice A: the versioned UI bundle manifest, served alongside
 * bubble-config.json and chiptunes.json — same shape, same fallback
 * posture (BL-765 reuse posture), deliberately a sibling module rather
 * than a new mechanism. Android's UiBundleResolver decides which of
 * (fresh/cached/stale/bare) to render from this document; this module only
 * serves it.
 */
export interface LetsTalkUiBundleManifest {
  schemaVersion: number;
  bundleVersion: number;
  minShellVersion: number;
  payload: string;
}

const DEFAULT_MANIFEST: LetsTalkUiBundleManifest = {
  schemaVersion: 1,
  bundleVersion: 0,
  minShellVersion: 0,
  payload: '',
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Whole-document rejection, same posture as letsTalkBubbleConfig's
 * parseBubbleConfig: a missing or wrong-typed field returns null (the
 * caller falls through to the next fallback) rather than coercing a
 * partial manifest into existence. Unlike the Android-side
 * UiBundleResolver.parseUiBundleManifest (which is deliberately strict for
 * BL-654 whole-or-nothing), this bridge-side parser only guards the shape
 * the bridge itself writes/serves — the phone re-validates independently.
 */
function parseUiBundleManifest(raw: unknown): LetsTalkUiBundleManifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (
    !isFiniteNumber(record.schemaVersion) ||
    !isFiniteNumber(record.bundleVersion) ||
    !isFiniteNumber(record.minShellVersion) ||
    typeof record.payload !== 'string' ||
    record.payload.length === 0
  ) {
    return null;
  }
  return {
    schemaVersion: record.schemaVersion,
    bundleVersion: record.bundleVersion,
    minShellVersion: record.minShellVersion,
    payload: record.payload,
  };
}

function loadManifestFromFile(filePath: string): LetsTalkUiBundleManifest | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parseUiBundleManifest(parsed);
  } catch {
    return null;
  }
}

export function isLetsTalkUiBundlePath(url: string): boolean {
  const pathOnly = url.split('?', 1)[0];
  return pathOnly === '/lets-talk/ui-bundle.json' || pathOnly === '/lets-talk/ui-bundle';
}

/**
 * Bridge-served UI bundle manifest — same operator-file / rollback / force-
 * rollback / disabled posture as getLetsTalkBubbleConfig, so an operator
 * can push, and instantly roll back, a bundle the same way they already can
 * a capability flag.
 */
export function getLetsTalkUiBundleManifest(targetPath: string, env: NodeJS.ProcessEnv): LetsTalkUiBundleManifest {
  const operatorDir = path.join(targetPath, '.swarmforge', 'operator');
  const primaryPath = env.LETS_TALK_UI_BUNDLE_PATH || path.join(operatorDir, 'lets-talk-ui-bundle.json');
  const rollbackPath =
    env.LETS_TALK_UI_BUNDLE_ROLLBACK_PATH || path.join(operatorDir, 'lets-talk-ui-bundle.rollback.json');
  const forceRollback = boolFromEnv(env.LETS_TALK_UI_BUNDLE_FORCE_ROLLBACK);
  const disabled = boolFromEnv(env.LETS_TALK_UI_BUNDLE_DISABLED);

  if (disabled) {
    return DEFAULT_MANIFEST;
  }
  if (forceRollback) {
    return loadManifestFromFile(rollbackPath) ?? loadManifestFromFile(primaryPath) ?? DEFAULT_MANIFEST;
  }
  return loadManifestFromFile(primaryPath) ?? loadManifestFromFile(rollbackPath) ?? DEFAULT_MANIFEST;
}

export function getLetsTalkUiBundleManifestJsonBody(targetPath: string, env: NodeJS.ProcessEnv): string {
  return JSON.stringify(getLetsTalkUiBundleManifest(targetPath, env));
}
