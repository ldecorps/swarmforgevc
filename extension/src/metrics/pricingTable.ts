// BL-100 cost-03 / BL-627: a versioned, in-repo pricing table - data, not code.
// Updating a rate (or adding a new model) is a one-line PR to this file,
// never a code change to the cost computation itself. Rates are USD per
// million tokens, approximate as of authoring time; bump
// PRICING_TABLE_VERSION whenever a rate changes so downstream consumers
// (briefing, bridge) can note "as of pricing table vN" if they choose to.
//
// BL-627: rates verified against Anthropic published pricing (2026-07-25).
// claude-sonnet-5 keeps published list $3/$15 deliberately — introductory
// $2/$10 through 2026-08-31 is NOT modeled (time-bounded rates stay out of
// this table; list price during the intro window overstates that seat).
// No cron / scraper: roster drift is caught by checkPricingCoverage instead.

import * as fs from 'fs';
import * as path from 'path';

export const PRICING_TABLE_VERSION = 2;

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheCreatePerMTok: number;
  cacheReadPerMTok: number;
}

export const PRICING_TABLE: Record<string, ModelPricing> = {
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25, cacheCreatePerMTok: 6.25, cacheReadPerMTok: 0.5 },
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25, cacheCreatePerMTok: 6.25, cacheReadPerMTok: 0.5 },
  'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15, cacheCreatePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5, cacheCreatePerMTok: 1.25, cacheReadPerMTok: 0.1 },
  'claude-fable-5': { inputPerMTok: 10, outputPerMTok: 50, cacheCreatePerMTok: 12.5, cacheReadPerMTok: 1.0 },
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

/** Anthropic-native Claude API ids only (bare `claude-…`). */
const CLAUDE_MODEL_ID = /^claude-[A-Za-z0-9._-]+$/;

const CONF_MODEL =
  /(?:--model|coordinator_model)\s+(claude-[A-Za-z0-9._-]+)\b/g;
const JSON_MODEL = /"model"\s*:\s*"(claude-[A-Za-z0-9._-]+)"/g;

function addClaudeModelsFromText(text: string, into: Set<string>): void {
  for (const re of [CONF_MODEL, JSON_MODEL]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (CLAUDE_MODEL_ID.test(m[1])) {
        into.add(m[1]);
      }
    }
  }
}

function readIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Collect Anthropic-native Claude model ids referenced by the swarm roster
 * sources named in BL-627: swarmforge.conf, packs/*.conf, and
 * .swarmforge/launch/*.claude-settings.json. Provider-prefixed OpenRouter /
 * Mistral / etc. ids are ignored — they are outside this list-price table.
 */
export function collectReferencedClaudeModels(repoRoot: string): string[] {
  const found = new Set<string>();

  const confPath = path.join(repoRoot, 'swarmforge', 'swarmforge.conf');
  const confText = readIfExists(confPath);
  if (confText !== null) {
    addClaudeModelsFromText(confText, found);
  }

  const packsDir = path.join(repoRoot, 'swarmforge', 'packs');
  try {
    for (const name of fs.readdirSync(packsDir)) {
      if (!name.endsWith('.conf')) continue;
      const text = readIfExists(path.join(packsDir, name));
      if (text !== null) addClaudeModelsFromText(text, found);
    }
  } catch {
    // packs dir absent in a fixture is fine
  }

  const launchDir = path.join(repoRoot, '.swarmforge', 'launch');
  try {
    for (const name of fs.readdirSync(launchDir)) {
      if (!name.endsWith('.claude-settings.json')) continue;
      const text = readIfExists(path.join(launchDir, name));
      if (text !== null) addClaudeModelsFromText(text, found);
    }
  } catch {
    // launch dir is generated at runtime; empty/absent is fine
  }

  return [...found].sort();
}

export interface PricingCoverageResult {
  ok: boolean;
  referenced: string[];
  missing: string[];
  /** Fail-loud message naming every unpriced model; empty when ok. */
  message: string;
}

/**
 * Fail-loud coverage check: every Anthropic Claude model the swarm roster
 * references must have a PRICING_TABLE entry. No network.
 */
export function checkPricingCoverage(repoRoot: string): PricingCoverageResult {
  const referenced = collectReferencedClaudeModels(repoRoot);
  const missing = referenced.filter((model) => !PRICING_TABLE[model]);
  if (missing.length === 0) {
    return { ok: true, referenced, missing: [], message: '' };
  }
  const named = missing.join(', ');
  return {
    ok: false,
    referenced,
    missing,
    message: `PRICING_TABLE missing entries for swarm-referenced model(s): ${named}`,
  };
}

/** Throws when any referenced Claude model lacks a pricing entry. */
export function assertPricingCoverage(repoRoot: string): void {
  const result = checkPricingCoverage(repoRoot);
  if (!result.ok) {
    throw new Error(result.message);
  }
}
