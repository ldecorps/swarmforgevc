// Human-friendly model labels for UI surfaces (Resident Spy header, etc.).
// Internal model ids (settings files, PRICING_TABLE) stay canonical; this map
// is the only place display names need updating when Anthropic renames a tier.

export const MODEL_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'claude-sonnet-5': 'Sonnet 4.6',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-fable-5': 'Fable 5',
  'openai/qwen3.7-plus': 'Qwen 3.7 Plus',
  'openai/qwen3.7-max': 'Qwen 3.7 Max',
  'openai/qwen3.6-flash': 'Qwen 3.6 Flash',
};

export function formatModelDisplayName(modelId: string): string {
  if (MODEL_DISPLAY_NAMES[modelId]) {
    return MODEL_DISPLAY_NAMES[modelId];
  }
  if (modelId.startsWith('openai/')) {
    return modelId.slice('openai/'.length);
  }
  return modelId;
}
