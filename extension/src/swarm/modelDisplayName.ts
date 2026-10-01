// Human-friendly model labels for UI surfaces (Resident Spy header, etc.).
// Internal model ids (settings files, PRICING_TABLE) stay canonical; this map
// is the only place display names need updating when Anthropic renames a tier.

export const MODEL_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'claude-sonnet-5': 'Sonnet 5',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-opus-5': 'Opus 5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-fable-5': 'Fable 5',
  'claude-fable-5-1': 'Fable 5.1',
  'claude-opus-5-5': 'Opus 5.5',
  // Cursor seat (cursor-agent --model auto); steward identity cursor/auto.
  auto: 'Cursor Auto',
  'cursor/auto': 'Cursor Auto',
  'copilot/auto': 'Copilot Auto',
  'openai/qwen3.7-plus': 'Qwen 3.7 Plus',
  'openai/qwen3.7-max': 'Qwen 3.7 Max',
  'openai/qwen3.6-flash': 'Qwen 3.6 Flash',
};

// BL-1858: a local Ollama qwen coder tag, quantisation and tag dropped -
// qwen2.5-coder-14b-q5km:latest -> Qwen2.5 Coder 14B.
const OLLAMA_QWEN_CODER = /^qwen(\d+(?:\.\d+)?)-coder(?:[-:](\d+)b)?/i;

function formatOllamaQwenCoder(modelId: string): string | undefined {
  const match = OLLAMA_QWEN_CODER.exec(modelId);
  return match ? `Qwen${match[1]} Coder${match[2] ? ` ${match[2]}B` : ''}` : undefined;
}

export function formatModelDisplayName(modelId: string): string {
  if (MODEL_DISPLAY_NAMES[modelId]) {
    return MODEL_DISPLAY_NAMES[modelId];
  }
  const qwenCoder = formatOllamaQwenCoder(modelId);
  if (qwenCoder) {
    return qwenCoder;
  }
  if (modelId.startsWith('openai/')) {
    return modelId.slice('openai/'.length);
  }
  return modelId;
}
