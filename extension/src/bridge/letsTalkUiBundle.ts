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
export interface LetsTalkUiBundlePage {
  id: string;
  title: string;
  entryPath: string;
  order: number;
}

export interface LetsTalkUiBundleManifest {
  schemaVersion: number;
  bundleVersion: number;
  minShellVersion: number;
  payload: string;
  pages: LetsTalkUiBundlePage[];
}

const DEFAULT_MANIFEST: LetsTalkUiBundleManifest = {
  schemaVersion: 1,
  bundleVersion: 0,
  minShellVersion: 0,
  payload: '',
  pages: [],
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlainManifestObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * BL-829: a page entry is the allowlist unit the shell's WebView is ever
 * permitted to open — same whole-or-nothing rejection posture as the rest
 * of the manifest (BL-654 invariant 2), so one malformed entry can't sneak
 * a partially-validated page list past the caller.
 */
function isValidPage(raw: unknown): raw is LetsTalkUiBundlePage {
  return (
    isPlainManifestObject(raw) &&
    isNonEmptyString(raw.id) &&
    isNonEmptyString(raw.title) &&
    isNonEmptyString(raw.entryPath) &&
    isFiniteNumber(raw.order)
  );
}

function isValidPageList(raw: unknown): raw is LetsTalkUiBundlePage[] {
  return Array.isArray(raw) && raw.every(isValidPage);
}

function hasValidCoreManifestFields(record: Record<string, unknown>): boolean {
  return (
    isFiniteNumber(record.schemaVersion) &&
    isFiniteNumber(record.bundleVersion) &&
    isFiniteNumber(record.minShellVersion) &&
    typeof record.payload === 'string' &&
    record.payload.length > 0
  );
}

function hasValidPagesField(record: Record<string, unknown>): boolean {
  return record.pages === undefined || isValidPageList(record.pages);
}

function hasValidManifestFields(record: Record<string, unknown>): boolean {
  return hasValidCoreManifestFields(record) && hasValidPagesField(record);
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
  if (!isPlainManifestObject(raw) || !hasValidManifestFields(raw)) {
    return null;
  }
  return {
    schemaVersion: raw.schemaVersion as number,
    bundleVersion: raw.bundleVersion as number,
    minShellVersion: raw.minShellVersion as number,
    payload: raw.payload as string,
    pages: isValidPageList(raw.pages) ? raw.pages : [],
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

function resolveUiBundlePaths(targetPath: string, env: NodeJS.ProcessEnv): { primaryPath: string; rollbackPath: string } {
  const operatorDir = path.join(targetPath, '.swarmforge', 'operator');
  return {
    primaryPath: env.LETS_TALK_UI_BUNDLE_PATH || path.join(operatorDir, 'lets-talk-ui-bundle.json'),
    rollbackPath:
      env.LETS_TALK_UI_BUNDLE_ROLLBACK_PATH || path.join(operatorDir, 'lets-talk-ui-bundle.rollback.json'),
  };
}

function loadManifestPreferring(preferredPath: string, fallbackPath: string): LetsTalkUiBundleManifest {
  return loadManifestFromFile(preferredPath) ?? loadManifestFromFile(fallbackPath) ?? DEFAULT_MANIFEST;
}

/**
 * Bridge-served UI bundle manifest — same operator-file / rollback / force-
 * rollback / disabled posture as getLetsTalkBubbleConfig, so an operator
 * can push, and instantly roll back, a bundle the same way they already can
 * a capability flag.
 */
export function getLetsTalkUiBundleManifest(targetPath: string, env: NodeJS.ProcessEnv): LetsTalkUiBundleManifest {
  const { primaryPath, rollbackPath } = resolveUiBundlePaths(targetPath, env);
  if (boolFromEnv(env.LETS_TALK_UI_BUNDLE_DISABLED)) {
    return DEFAULT_MANIFEST;
  }
  return boolFromEnv(env.LETS_TALK_UI_BUNDLE_FORCE_ROLLBACK)
    ? loadManifestPreferring(rollbackPath, primaryPath)
    : loadManifestPreferring(primaryPath, rollbackPath);
}
