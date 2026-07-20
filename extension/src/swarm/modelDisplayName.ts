// Human-friendly model labels for UI surfaces (Resident Spy header, etc.).
// Internal model ids (settings files, PRICING_TABLE) stay canonical; this map
// is the only place display names need updating when Anthropic renames a tier.

export const MODEL_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'claude-sonnet-5': 'Sonnet 4.6',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-fable-5': 'Fable 5',
};

export function formatModelDisplayName(modelId: string): string {
  return MODEL_DISPLAY_NAMES[modelId] ?? modelId;
}
