// BL-118: the shared read-cache/build-engine/write-cache-back orchestration
// every artifact-generating CLI (generate-docs-tree.ts,
// generate-backlog-dashboard.ts) needs around its own translation pass -
// factored out once rather than duplicated in both.

import { readTranslationCache, writeTranslationCache } from './translationCache';
import { createDeeplEngine, createNullMtEngine, MtEngine } from './mtEngine';
import { createTranslationSession, TranslationSession } from './translate';

// No MT_API_KEY configured (local dev, or before the operator wires the CI
// secret) falls back to the null engine: every string publishes as English
// flagged untranslated (bilingual-05) rather than failing the build.
function resolveMtEngine(): MtEngine {
  const apiKey = process.env.MT_API_KEY;
  if (!apiKey) {
    return createNullMtEngine();
  }
  return createDeeplEngine(apiKey);
}

export function createCliTranslationSession(targetPath: string): TranslationSession {
  return createTranslationSession(readTranslationCache(targetPath), resolveMtEngine());
}

// Always writes back, even when nothing changed (a byte-identical rewrite
// is a no-op diff for whatever commits docs/i18n/translation-cache.json
// afterward) - simpler than tracking a dirty flag through every call site.
export function persistCliTranslationSession(targetPath: string, session: TranslationSession): void {
  writeTranslationCache(targetPath, session.cache);
}
