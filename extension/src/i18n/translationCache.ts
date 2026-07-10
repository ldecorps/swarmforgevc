// BL-118: the content-hash translation cache - committed to the repo
// (docs/i18n/translation-cache.json) so builds are reproducible and an
// unchanged source string is never re-translated across publishes
// (bilingual-03). Read/write idiom mirrors canaryInjector.ts's
// canary-status.json: defensive read (a missing/corrupt file just means an
// empty cache, not a fatal error), atomic whole-file write.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';

export function hashSourceText(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// BL-230: bumped from 1 - entries gained a locale dimension (a single
// target language collided across locales otherwise: schema 1 stored one
// string per hash with no way to tell which language it was). A schema-1
// (or any unrecognized-shape) cache reads as empty rather than
// misinterpreted, so the next build just re-translates everything once -
// never a crash, matching this cache's existing defensive-read posture.
export const TRANSLATION_CACHE_SCHEMA_VERSION = 2;

export interface TranslationCacheData {
  schemaVersion: number;
  // hash of the source string -> { locale code -> translated text }
  entries: Record<string, Record<string, string>>;
}

export function emptyTranslationCache(): TranslationCacheData {
  return { schemaVersion: TRANSLATION_CACHE_SCHEMA_VERSION, entries: {} };
}

export function translationCacheFile(targetPath: string): string {
  return path.join(targetPath, 'docs', 'i18n', 'translation-cache.json');
}

export function readTranslationCache(targetPath: string): TranslationCacheData {
  try {
    const content = fs.readFileSync(translationCacheFile(targetPath), 'utf-8');
    const parsed = JSON.parse(content);
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.schemaVersion === TRANSLATION_CACHE_SCHEMA_VERSION &&
      parsed.entries &&
      typeof parsed.entries === 'object'
    ) {
      return parsed as TranslationCacheData;
    }
    return emptyTranslationCache();
  } catch {
    return emptyTranslationCache();
  }
}

export function writeTranslationCache(targetPath: string, cache: TranslationCacheData): void {
  atomicWrite(translationCacheFile(targetPath), JSON.stringify(cache, null, 2) + '\n');
}
