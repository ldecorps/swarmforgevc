// BL-118: the Action-side MT engine used at publish time. postFn is
// injectable so tests never make a real network call and never need a real
// API key - same posture as notify/resendClient.ts. Engine choice is
// DeepL (simple single-key REST API); MtEngine is the abstract seam a
// different provider could implement without touching translate.ts.
import { authenticatedPost } from '../util/authenticatedPost';

export interface TranslateResult {
  success: boolean;
  text?: string;
  error?: string;
}

export interface MtEngine {
  translate(text: string, targetLang: string): Promise<TranslateResult>;
}

// Always fails, mirroring bilingual-05's own designed degrade path: no
// MT_API_KEY configured (e.g. local dev, or before the operator sets up
// the CI secret) still publishes successfully, with every string flagged
// untranslated - never a hard requirement to have translation working.
export function createNullMtEngine(): MtEngine {
  return {
    async translate(): Promise<TranslateResult> {
      return { success: false, error: 'no MT engine configured' };
    },
  };
}

const DEEPL_API_URL = 'https://api-free.deepl.com/v2/translate';

export interface PostResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type PostFn = (url: string, body: string, apiKey: string) => Promise<PostResponse>;

async function defaultPost(url: string, body: string, apiKey: string): Promise<PostResponse> {
  const res = await authenticatedPost(url, body, `DeepL-Auth-Key ${apiKey}`);
  return { ok: res.ok, status: res.status, json: () => res.json() };
}

interface DeeplTranslateResponse {
  translations?: Array<{ text?: string }>;
}

function isDeeplTranslateResponse(value: unknown): value is DeeplTranslateResponse {
  return typeof value === 'object' && value !== null;
}

export function createDeeplEngine(apiKey: string, postFn: PostFn = defaultPost): MtEngine {
  return {
    async translate(text: string, targetLang: string): Promise<TranslateResult> {
      // BL-230: tag_handling/ignore_tags is DeepL's own documented
      // mechanism for "translate around this span verbatim" - jargonPreserve.ts
      // wraps preserved tokens in <jargon> tags before this call; DeepL
      // passes their content through untouched (the tags themselves stay
      // in the response, stripped back out by translate.ts afterward).
      // Harmless to always set: a no-op when the text has no such tags.
      const body = JSON.stringify({
        text: [text],
        target_lang: targetLang.toUpperCase(),
        tag_handling: 'xml',
        ignore_tags: ['jargon'],
      });
      try {
        const res = await postFn(DEEPL_API_URL, body, apiKey);
        if (!res.ok) {
          return { success: false, error: `DeepL API responded with status ${res.status}` };
        }
        const data = await res.json();
        const translated = isDeeplTranslateResponse(data) ? data.translations?.[0]?.text : undefined;
        if (typeof translated !== 'string') {
          return { success: false, error: 'DeepL response missing translated text' };
        }
        return { success: true, text: translated };
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'unknown error';
        // Never let the key leak into a thrown error's message, mirroring
        // resendClient.ts's own defensive redaction.
        const safeDetail = detail.split(apiKey).join('[redacted]');
        return { success: false, error: `DeepL request failed: ${safeDetail}` };
      }
    },
  };
}
