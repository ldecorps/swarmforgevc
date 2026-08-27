// BL-565: list-price synthetic dollars for Max-billed llm_invocation rows.
import { estimateCostUsd, PRICING_TABLE_VERSION, UsageTotalsForCost } from './pricingTable';
import type { LlmInvocationRecord, LlmInvocationTokens } from './llmCostLedger';

export const PRICING_TABLE_AS_OF_LABEL = `pricing table v${PRICING_TABLE_VERSION}`;

export function tokensToUsage(tokens: LlmInvocationTokens): UsageTotalsForCost | null {
  if (tokens.inputTokens === null || tokens.outputTokens === null) {
    return null;
  }
  return {
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheCreationTokens: tokens.cacheCreationTokens ?? 0,
    cacheReadTokens: tokens.cacheReadTokens ?? 0,
  };
}

export function deriveSyntheticCostUsd(record: LlmInvocationRecord): number | null {
  if (record.costUsd !== null) {
    return null;
  }
  const model = record.model ?? record.origin.model;
  if (!model || !record.tokens) {
    return null;
  }
  const usage = tokensToUsage(record.tokens);
  if (!usage) {
    return null;
  }
  const estimate = estimateCostUsd(usage, model);
  if (estimate === null || estimate <= 0) {
    return null;
  }
  return estimate;
}

export function enrichLlmInvocationRecord(record: LlmInvocationRecord): LlmInvocationRecord {
  const derived = deriveSyntheticCostUsd(record);
  if (derived === null) {
    return record;
  }
  return { ...record, syntheticCostUsd: derived };
}

export function isUnknownSyntheticPrice(record: LlmInvocationRecord): boolean {
  if (record.costUsd !== null) {
    return false;
  }
  const model = record.model ?? record.origin.model;
  if (!model || !record.tokens) {
    return false;
  }
  return tokensToUsage(record.tokens) !== null && deriveSyntheticCostUsd(record) === null;
}
