// BL-207: provider contract slice 3 - a stable, closed Forge-level error
// taxonomy so orchestration and operator views can branch on failure
// CATEGORY, never brand-specific message text. Maps whatever raw,
// provider-specific failure detail is already available (stderr/stdout,
// an exit code, a Node error message/code) onto one of a small closed set
// of categories, keeping that original detail attached as context rather
// than discarding it (BL-217's extractEmailFields sets the precedent for
// this posture: exact wording was not independently confirmed against live
// docs for every provider brand while building this - an unrecognized
// detail safely falls back to "unknown" with the detail attached, never a
// crash).
//
// Mirrored exactly (same categories, same keyword patterns) by
// swarmforge/scripts/agent_runtime_lib.bb's classify-provider-error, so the
// fork orchestration side and this extension-host side always agree on
// which category a given failure text belongs to.

export type ForgeErrorCategory = 'launch-failed' | 'auth' | 'unavailable' | 'protocol' | 'timeout' | 'unknown';

export interface NormalizedProviderError {
  category: ForgeErrorCategory;
  detail: string;
}

const CATEGORY_PATTERNS: Array<{ category: ForgeErrorCategory; pattern: RegExp }> = [
  { category: 'timeout', pattern: /\btimed?[\s-]?out\b|ETIMEDOUT/i },
  {
    category: 'auth',
    pattern: /\b(unauthorized|forbidden|invalid api[\s-]?key|invalid[\s\S]*credential|authentication failed|401|403)\b/i,
  },
  { category: 'unavailable', pattern: /\b(rate[\s-]?limit|too many requests|overloaded|service unavailable|429|503)\b/i },
  {
    category: 'launch-failed',
    pattern: /\b(enoent|command not found|no such file|cannot spawn|no launch script|no tmux socket|no .*wrapper found|failed to start)\b/i,
  },
  { category: 'protocol', pattern: /\b(unexpected token|json[\s\S]*pars|parse error|malformed|invalid response)\b/i },
];

/**
 * Maps a raw backend failure detail onto one of the closed Forge error
 * categories. code, if given (e.g. Node's err.code such as 'ETIMEDOUT' or
 * 'ENOENT'), is folded into the same text search as detail - a more
 * reliable structured signal reads through the identical pattern table, so
 * a code and its equivalent free-text wording always agree on category.
 * Falls back to "unknown" - detail is never discarded, never a crash.
 */
export function classifyProviderError(detail: string, code?: string): NormalizedProviderError {
  const haystack = code ? `${code} ${detail}` : detail;
  for (const { category, pattern } of CATEGORY_PATTERNS) {
    if (pattern.test(haystack)) {
      return { category, detail };
    }
  }
  return { category: 'unknown', detail };
}
