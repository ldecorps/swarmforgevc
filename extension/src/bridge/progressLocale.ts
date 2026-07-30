export type ProgressLocale = 'fr' | 'en';

const FRENCH_ACCENTS = /[àâäéèêëïîôùûüçœæ]/i;
const FRENCH_WORDS =
  /\b(tu|vous|je|nous|est|sont|avec|pour|dans|une?|les|des|que|qui|pas|plus|très|être|faire|ça|où|comment|pourquoi|bonjour|merci|peux|veux|cherche|explique|dis-moi)\b/gi;
const ENGLISH_WORDS =
  /\b(the|you|are|is|what|how|why|with|this|that|please|can|could|would|should|help|show|tell|find|write)\b/gi;

/** Guess chat language from the user prompt (French vs English). */
export function detectProgressLocale(text: string): ProgressLocale {
  const sample = text.trim().slice(0, 800);
  if (!sample) {
    return 'en';
  }
  let frScore = 0;
  if (FRENCH_ACCENTS.test(sample)) {
    frScore += 2;
  }
  frScore += sample.match(FRENCH_WORDS)?.length ?? 0;
  const enScore = sample.match(ENGLISH_WORDS)?.length ?? 0;
  if (frScore === 0 && enScore === 0) {
    return 'en';
  }
  return frScore >= enScore ? 'fr' : 'en';
}

export function promptTextForLocaleDetection(prompt: string | { text: string }): string {
  return typeof prompt === 'string' ? prompt : prompt.text;
}
