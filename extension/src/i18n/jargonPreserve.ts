// BL-230: the jargon preserve-list - a defined, reviewable set of tokens a
// machine translation must never alter (ticket ids, pipeline role names,
// the product name). Wraps each match in <jargon>...</jargon> before a
// translate() call and strips the tags back out afterward; DeepL's
// tag_handling=xml + ignore_tags=jargon (see mtEngine.ts) passes tagged
// content through byte-for-byte untranslated, so stripping the tags from
// the response restores the original token in place within the
// translated sentence. Engine-agnostic: any MtEngine that honors XML
// ignore-tags gets jargon preservation for free; one that doesn't simply
// leaves the visible tags in its output (a plainly-caught test failure,
// not a silent corruption).

const JARGON_PATTERNS: RegExp[] = [
  // Ticket ids: BL-230, GH-42, etc.
  /\b[A-Z]{2,}-\d+\b/,
  // Pipeline role names (case-insensitive - prose may say "the Coder" or "QA").
  /\b(?:specifier|coder|cleaner|architect|hardener|documenter|QA|coordinator)\b/i,
  // Product name.
  /\bSwarmForge\b/i,
];

const COMBINED_JARGON_REGEX = new RegExp(JARGON_PATTERNS.map((p) => `(?:${p.source})`).join('|'), 'gi');

export function wrapJargonForTranslation(text: string): string {
  return text.replace(COMBINED_JARGON_REGEX, (match) => `<jargon>${match}</jargon>`);
}

export function unwrapJargonTags(text: string): string {
  return text.replace(/<\/?jargon>/g, '');
}
