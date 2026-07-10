// BL-118/BL-230: the Action-side translation pass. A TranslationSession
// bundles a mutable cache + engine + running stats; translateString/
// translateMarkdown are the two leaf operations every docs-tree/backlog
// field goes through, now parameterized over an arbitrary target locale
// (BL-230 generalized this from a single fixed session.targetLang so ONE
// session/cache serves every configured target locale without collision -
// see translationCache.ts's schema bump). Nothing here ever throws or
// blocks the surrounding publish (bilingual-05): an engine failure degrades
// a string to source text, flagged untranslated. Jargon tokens (ticket ids,
// role names, product name - jargonPreserve.ts) are wrapped before the
// engine call and unwrapped after, so they survive translation verbatim.

import { hashSourceText, TranslationCacheData } from './translationCache';
import { MtEngine } from './mtEngine';
import { wrapJargonForTranslation, unwrapJargonTags } from './jargonPreserve';

export interface TranslationOutcome {
  text: string;
  untranslated?: boolean;
}

export interface TranslationStats {
  hits: number;
  misses: number;
  failures: number;
}

export interface TranslationSession {
  cache: TranslationCacheData;
  engine: MtEngine;
  stats: TranslationStats;
}

export function createTranslationSession(cache: TranslationCacheData, engine: MtEngine): TranslationSession {
  return { cache, engine, stats: { hits: 0, misses: 0, failures: 0 } };
}

// bilingual-03's cache contract: an unchanged source string (same content
// hash) is served from the cache without calling the engine at all - only
// a hash miss ever calls translate(). A blank/whitespace-only string is
// never sent to the engine either (nothing to translate, nothing to cache).
export async function translateString(session: TranslationSession, text: string, targetLocale: string): Promise<TranslationOutcome> {
  if (!text.trim()) {
    return { text };
  }
  const hash = hashSourceText(text);
  const cached = session.cache.entries[hash]?.[targetLocale];
  if (cached !== undefined) {
    session.stats.hits++;
    return { text: cached };
  }
  session.stats.misses++;
  const result = await session.engine.translate(wrapJargonForTranslation(text), targetLocale);
  if (!result.success || typeof result.text !== 'string') {
    session.stats.failures++;
    return { text, untranslated: true };
  }
  const translated = unwrapJargonTags(result.text);
  session.cache.entries[hash] = { ...session.cache.entries[hash], [targetLocale]: translated };
  return { text: translated };
}

export interface MarkdownSegment {
  kind: 'prose' | 'code';
  text: string;
}

const FENCE_LINE = /^```/;

// bilingual-06: code fences embedded in a markdown doc are never sent to
// the MT engine. Splits on ``` fence lines into alternating prose/code
// segments (each segment's own text already includes its fence lines where
// applicable), so segments.map(s => s.text).join('\n') always reconstructs
// the exact original markdown - callers translate only the prose segments
// and leave code segments untouched before rejoining.
export function segmentMarkdown(markdown: string): MarkdownSegment[] {
  const lines = markdown.split('\n');
  const segments: MarkdownSegment[] = [];
  let buffer: string[] = [];
  let kind: MarkdownSegment['kind'] = 'prose';

  const flush = () => {
    if (buffer.length > 0) {
      segments.push({ kind, text: buffer.join('\n') });
      buffer = [];
    }
  };

  for (const line of lines) {
    if (FENCE_LINE.test(line)) {
      if (kind === 'prose') {
        flush();
        kind = 'code';
        buffer.push(line);
      } else {
        buffer.push(line);
        flush();
        kind = 'prose';
      }
      continue;
    }
    buffer.push(line);
  }
  flush();
  return segments;
}

// Translates a markdown document's prose segments only, leaving fenced
// code blocks verbatim, then rejoins into one rendering in the target
// locale. Any one segment's translation failure flags the whole document
// untranslated (a mixed partially-translated/partially-flagged document
// would be confusing to render; bilingual-05 only requires the publish
// itself to succeed, not partial-credit translation).
export async function translateMarkdown(session: TranslationSession, markdown: string, targetLocale: string): Promise<TranslationOutcome> {
  const segments = segmentMarkdown(markdown);
  const parts: string[] = [];
  let anyUntranslated = false;
  for (const segment of segments) {
    if (segment.kind === 'code') {
      parts.push(segment.text);
      continue;
    }
    const translated = await translateString(session, segment.text, targetLocale);
    parts.push(translated.text);
    if (translated.untranslated) {
      anyUntranslated = true;
    }
  }
  const result: TranslationOutcome = { text: parts.join('\n') };
  if (anyUntranslated) {
    result.untranslated = true;
  }
  return result;
}
