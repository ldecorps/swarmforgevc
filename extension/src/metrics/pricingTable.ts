// BL-100 cost-03: a versioned, in-repo pricing table - data, not code.
// Updating a rate (or adding a new model) is a one-line PR to this file,
// never a code change to the cost computation itself. Rates are USD per
// million tokens, approximate as of authoring time; bump
// PRICING_TABLE_VERSION whenever a rate changes so downstream consumers
// (briefing, bridge) can note "as of pricing table vN" if they choose to.

export const PRICING_TABLE_VERSION = 1;

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheCreatePerMTok: number;
  cacheReadPerMTok: number;
}

export const PRICING_TABLE: Record<string, ModelPricing> = {
  'claude-opus-4-8': { inputPerMTok: 15, outputPerMTok: 75, cacheCreatePerMTok: 18.75, cacheReadPerMTok: 1.5 },
  'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15, cacheCreatePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  'claude-haiku-4-5-20251001': { inputPerMTok: 0.8, outputPerMTok: 4, cacheCreatePerMTok: 1.0, cacheReadPerMTok: 0.08 },
  'claude-fable-5': { inputPerMTok: 15, outputPerMTok: 75, cacheCreatePerMTok: 18.75, cacheReadPerMTok: 1.5 },
};

export interface UsageTotalsForCost {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

// Returns null for a model absent from the table rather than guessing a
// rate or silently reporting zero - an unpriced model must read as "no
// cost data for this model", never a misleading $0.
export function estimateCostUsd(usage: UsageTotalsForCost, model: string): number | null {
  const rates = PRICING_TABLE[model];
  if (!rates) {
    return null;
  }
  return (
    (usage.inputTokens / 1_000_000) * rates.inputPerMTok +
    (usage.outputTokens / 1_000_000) * rates.outputPerMTok +
    (usage.cacheCreationTokens / 1_000_000) * rates.cacheCreatePerMTok +
    (usage.cacheReadTokens / 1_000_000) * rates.cacheReadPerMTok
  );
}
