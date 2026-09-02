// BL-100 cost-03 / BL-627: a versioned, in-repo pricing table - data, not code.
// Updating a rate (or adding a new model) is a one-line PR to this file,
// never a code change to the cost computation itself. Rates are USD per
// million tokens, approximate as of authoring time; bump
// PRICING_TABLE_VERSION whenever a rate changes so downstream consumers
// (briefing, bridge) can note "as of pricing table vN" if they choose to.
//
// BL-627: rates verified against Anthropic published pricing (2026-07-25).
// BL-1056 reverses BL-627's one deliberate omission: a rate that is only
// valid until a date is now expressed HERE, in this table, and nowhere else —
// the intake's constraint is one source of truth, never a sibling windows
// file. A row gains `until`/`then` ONLY when it has a window; every other row
// keeps the one-line shape BL-627 chose, and is costed identically at every
// instant. No cron / scraper: roster drift is caught by checkPricingCoverage.

import * as fs from 'fs';
import * as path from 'path';

export const PRICING_TABLE_VERSION = 3;

export interface Rates {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheCreatePerMTok: number;
  cacheReadPerMTok: number;
}

export interface ModelPricing extends Rates {
  /**
   * BL-1056, optional: the last day (inclusive, UTC `YYYY-MM-DD`) on which
   * this row's own rates apply. Absent on every windowless model.
   */
  until?: string;
  /**
   * The rates that take over the day after `until`. Explicit `null` means the
   * model has no rate at all after the window, which costs like an unpriced
   * model — null, never a fallback rate and never zero.
   */
  then?: Rates | null;
}

/** The day Anthropic's introductory Sonnet 5 rate stops applying. */
export const SONNET_5_INTRO_WINDOW_END = '2026-08-31';

/** How far ahead of a boundary the staleness query starts naming a window. */
export const PRICING_WINDOW_ALERT_DAYS = 30;

export const PRICING_TABLE: Record<string, ModelPricing> = {
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25, cacheCreatePerMTok: 6.25, cacheReadPerMTok: 0.5 },
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25, cacheCreatePerMTok: 6.25, cacheReadPerMTok: 0.5 },
  // The only windowed row: introductory $2/$10 through 2026-08-31, published
  // list $3/$15 from 2026-09-01. Six of the seven pipeline windows run this
  // model, so costing it at list inside the window overstated them by 50%.
  'claude-sonnet-5': {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheCreatePerMTok: 2.5,
    cacheReadPerMTok: 0.2,
    until: SONNET_5_INTRO_WINDOW_END,
    then: { inputPerMTok: 3, outputPerMTok: 15, cacheCreatePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  },
  'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5, cacheCreatePerMTok: 1.25, cacheReadPerMTok: 0.1 },
  'claude-fable-5': { inputPerMTok: 10, outputPerMTok: 50, cacheCreatePerMTok: 12.5, cacheReadPerMTok: 1.0 },
};

export interface UsageTotalsForCost {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/** The instant a `YYYY-MM-DD` window stops applying: midnight UTC the next day. */
function endOfWindow(until: string): number {
  return Date.parse(`${until}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
}

/**
 * The rates in force for `entry` at `at`, or null when no window covers that
 * instant. A windowless entry answers its own rates at every instant, exactly
 * as before BL-1056.
 */
export function resolveRatesAt(entry: ModelPricing | undefined, at: Date): Rates | null {
  if (!entry) {
    return null;
  }
  if (entry.until === undefined) {
    return entry;
  }
  if (at.getTime() < endOfWindow(entry.until)) {
    return entry;
  }
  return entry.then ?? null;
}

function costFrom(usage: UsageTotalsForCost, rates: Rates): number {
  return (
    (usage.inputTokens / 1_000_000) * rates.inputPerMTok +
    (usage.outputTokens / 1_000_000) * rates.outputPerMTok +
    (usage.cacheCreationTokens / 1_000_000) * rates.cacheCreatePerMTok +
    (usage.cacheReadTokens / 1_000_000) * rates.cacheReadPerMTok
  );
}

/**
 * Cost `usage` for `model` at a named instant. Returns null - never a
 * fallback rate, never zero - for a model absent from the table AND for one
 * whose windows leave `at` uncovered: both read as "no cost data for this
 * model at this instant" (BL-627's honest-null discipline, BL-1056's second
 * invariant).
 */
export function estimateCostUsdAt(
  usage: UsageTotalsForCost,
  model: string,
  at: Date,
  table: Record<string, ModelPricing> = PRICING_TABLE
): number | null {
  const rates = resolveRatesAt(table[model], at);
  return rates ? costFrom(usage, rates) : null;
}

/**
 * Cost `usage` for `model`, at `at` when given and otherwise at the current
 * instant. Callers that do not care about time keep their one-argument shape
 * and get the rate in force now.
 */
export function estimateCostUsd(
  usage: UsageTotalsForCost,
  model: string,
  at: Date = new Date(),
  table: Record<string, ModelPricing> = PRICING_TABLE
): number | null {
  return estimateCostUsdAt(usage, model, at, table);
}

export interface PricingWindowAlert {
  model: string;
  /** The last day the current rates apply. */
  until: string;
  status: 'closed' | 'closing';
  /** Whole days from `at` to the boundary; negative once it has passed. */
  daysRemaining: number;
}

/**
 * The cliff as a QUERY rather than a memory: every windowed entry whose
 * boundary has passed, or falls within PRICING_WINDOW_ALERT_DAYS. Windowless
 * entries are never named - they have nothing to go stale.
 */
export function listPricingWindowAlerts(
  at: Date = new Date(),
  table: Record<string, ModelPricing> = PRICING_TABLE
): PricingWindowAlert[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const alerts: PricingWindowAlert[] = [];
  for (const [model, entry] of Object.entries(table)) {
    if (entry.until === undefined) {
      continue;
    }
    const daysRemaining = Math.floor((endOfWindow(entry.until) - at.getTime()) / dayMs);
    if (daysRemaining < 0) {
      alerts.push({ model, until: entry.until, status: 'closed', daysRemaining });
    } else if (daysRemaining <= PRICING_WINDOW_ALERT_DAYS) {
      alerts.push({ model, until: entry.until, status: 'closing', daysRemaining });
    }
  }
  return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining || a.model.localeCompare(b.model));
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

function addClaudeModelsFromDir(dirPath: string, suffix: string, found: Set<string>): void {
  try {
    for (const name of fs.readdirSync(dirPath)) {
      if (!name.endsWith(suffix)) {
        continue;
      }
      const text = readIfExists(path.join(dirPath, name));
      if (text !== null) {
        addClaudeModelsFromText(text, found);
      }
    }
  } catch {
    // absent dir in a fixture is fine
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

  const confText = readIfExists(path.join(repoRoot, 'swarmforge', 'swarmforge.conf'));
  if (confText !== null) {
    addClaudeModelsFromText(confText, found);
  }

  addClaudeModelsFromDir(path.join(repoRoot, 'swarmforge', 'packs'), '.conf', found);
  addClaudeModelsFromDir(path.join(repoRoot, '.swarmforge', 'launch'), '.claude-settings.json', found);

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
