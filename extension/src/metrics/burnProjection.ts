// BL-619: pure projection logic for the morning briefing's token-burn
// exhaustion warning. Every decision here is a function of (anchors, local
// burn rate, config, an injected nowMs) - no wall-clock reads, matching the
// ticket's own "pinned clock in every test" gate. The account percentage
// itself is never programmatically readable (verified 2026-07-25 - no
// endpoint exists), so every percentage this module produces traces back to
// a human-recorded anchor (see usageAnchorStore.ts); this module never
// invents one.
//
// Config (swarmforge.conf, `config <key> <value>` lines):
//   usage_week_reset_day thu       (absent => thu; matches the incident)
//   usage_week_reset_local 07:00   (absent => 07:00)
// Reset times are local wall-clock on the swarm host, mirroring
// cooldownWindowCore.ts's own local-time posture - reused directly below
// (parseLocalTime) rather than re-implemented.

import { parseConfigValue } from '../util/swarmforgeConfig';
import { parseLocalTime, LocalTime } from '../tools/cooldownWindowCore';

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface UsageAnchor {
  atMs: number;
  pct: number;
  scope: string;
}

export interface WeekResetConfig {
  resetDay: number; // 0=Sun .. 6=Sat, matching Date#getDay()
  resetLocal: LocalTime;
}

export interface ParsedWeekResetConfig {
  config: WeekResetConfig | null;
  malformed: boolean;
  warning?: string;
}

const DEFAULT_RESET_DAY = 4; // Thursday
const DEFAULT_RESET_LOCAL: LocalTime = { hour: 7, minute: 0 };
const WEEKDAY_PREFIXES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Accepts a 3+ letter, case-insensitive weekday name/prefix ("thu",
// "Thursday"). Anything else (typo, number, blank) is malformed - never
// guessed.
export function parseWeekday(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const prefix = value.trim().toLowerCase().slice(0, 3);
  const idx = WEEKDAY_PREFIXES.indexOf(prefix);
  return idx === -1 ? null : idx;
}

function resolveResetDay(dayRaw: string | undefined): number | null {
  return dayRaw === undefined ? DEFAULT_RESET_DAY : parseWeekday(dayRaw);
}

function resolveResetLocal(localRaw: string | undefined): LocalTime | null {
  return localRaw === undefined ? DEFAULT_RESET_LOCAL : parseLocalTime(localRaw);
}

function formatConfigRawLabel(raw: string | undefined): string {
  return raw ?? '(default)';
}

export function parseWeekResetConfig(confContent: string): ParsedWeekResetConfig {
  const dayRaw = parseConfigValue(confContent, 'usage_week_reset_day');
  const localRaw = parseConfigValue(confContent, 'usage_week_reset_local');
  const resetDay = resolveResetDay(dayRaw);
  const resetLocal = resolveResetLocal(localRaw);

  if (resetDay === null || !resetLocal) {
    return {
      config: null,
      malformed: true,
      warning: `malformed usage week reset config: day=${formatConfigRawLabel(dayRaw)} local=${formatConfigRawLabel(localRaw)}`,
    };
  }
  return { config: { resetDay, resetLocal }, malformed: false };
}

// The next occurrence of resetDay/resetLocal strictly after (or exactly at)
// nowMs, local wall-clock. Mirrors cooldownWindowCore.ts's
// currentWindowStartMs day-stepping approach, extended to a 7-day cadence.
export function nextWeeklyResetMs(nowMs: number, resetDay: number, resetLocal: LocalTime): number {
  const now = new Date(nowMs);
  const dayDiff = (resetDay - now.getDay() + 7) % 7;
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), resetLocal.hour, resetLocal.minute, 0, 0);
  candidate.setDate(candidate.getDate() + dayDiff);
  if (candidate.getTime() <= nowMs) {
    candidate.setDate(candidate.getDate() + 7);
  }
  return candidate.getTime();
}

// The start of the weekly window nowMs currently sits in - always the
// reset instant 7 days before the next one, so it lands at or before nowMs
// by construction (nextWeeklyResetMs is always within (0, 7] days ahead).
export function currentWeeklyWindowStartMs(nowMs: number, resetDay: number, resetLocal: LocalTime): number {
  return nextWeeklyResetMs(nowMs, resetDay, resetLocal) - 7 * MS_PER_DAY;
}

export interface DerivedBurnRate {
  ratePctPerDay: number;
  latestPct: number;
  latestAtMs: number;
}

// warning-leads-briefing-04/05: with >=2 anchors in the current window, the
// rate uses only the LATEST pair (the freshest read on how fast the human
// is actually burning right now, not a longer-run average that a stale
// early anchor would drag down/up). With exactly one, it falls back to the
// average since the window opened (the window itself opens at 0%, so the
// single anchor is one leg of that average). Anchors are assumed already
// filtered to the current window - callers do that filtering (composeBurnSection
// below), keeping this function a pure fold over whatever it is given.
export function deriveBurnRateFromAnchors(anchorsInWindow: UsageAnchor[], windowStartMs: number): DerivedBurnRate | null {
  if (anchorsInWindow.length === 0) {
    return null;
  }
  const sorted = [...anchorsInWindow].sort((a, b) => a.atMs - b.atMs);
  if (sorted.length === 1) {
    const [only] = sorted;
    const elapsedMs = only.atMs - windowStartMs;
    // A same-instant-as-window-open anchor has no elapsed time to average
    // over; degrade to a 0 rate rather than dividing by zero - untested by
    // any scenario, but the safe (never-crash, never-fabricate-a-spike)
    // choice.
    const ratePctPerDay = elapsedMs > 0 ? only.pct / (elapsedMs / MS_PER_DAY) : 0;
    return { ratePctPerDay, latestPct: only.pct, latestAtMs: only.atMs };
  }
  const latest = sorted[sorted.length - 1];
  const prior = sorted[sorted.length - 2];
  const elapsedMs = latest.atMs - prior.atMs;
  const ratePctPerDay = elapsedMs > 0 ? (latest.pct - prior.pct) / (elapsedMs / MS_PER_DAY) : 0;
  return { ratePctPerDay, latestPct: latest.pct, latestAtMs: latest.atMs };
}

// A rate <= 0 never reaches 100% - projected exhaustion is "never", modeled
// as +Infinity so decideProjection's < comparison naturally resolves to 'ok'.
export function computeProjectedExhaustionMs(pct: number, atMs: number, ratePctPerDay: number): number {
  if (ratePctPerDay <= 0) {
    return Infinity;
  }
  return atMs + ((100 - pct) / ratePctPerDay) * MS_PER_DAY;
}

// projection-decision-table-02: warn iff the projected exhaustion instant
// falls BEFORE the next reset - the directive's own wording ("warn iff
// projected exhaustion falls before the next reset").
export function decideProjection(pct: number, atMs: number, ratePctPerDay: number, nextResetMs: number): 'warn' | 'ok' {
  return computeProjectedExhaustionMs(pct, atMs, ratePctPerDay) < nextResetMs ? 'warn' : 'ok';
}

export type BurnSectionResult =
  | { kind: 'malformed'; localBurnRateTokensPerHour: number; warning: string }
  | { kind: 'no-anchor'; localBurnRateTokensPerHour: number }
  | { kind: 'ok'; ratePctPerDay: number }
  | { kind: 'warn'; ratePctPerDay: number; runOutAtMs: number };

export interface BurnSectionInputs {
  anchors: UsageAnchor[];
  nowMs: number;
  resetConfig: ParsedWeekResetConfig;
  localBurnRateTokensPerHour: number;
  anchorScope: string;
}

// The one composition point: malformed config beats everything else (no
// window/reset can be computed at all - malformed-reset-config-08), then no
// anchor in the current window (no-anchor-never-fabricates-06), then the
// real projection-vs-reset decision (warning-leads-briefing-01 /
// ok-path-one-line-status-03).
export function composeBurnSection(inputs: BurnSectionInputs): BurnSectionResult {
  const { anchors, nowMs, resetConfig, localBurnRateTokensPerHour, anchorScope } = inputs;
  if (resetConfig.malformed || !resetConfig.config) {
    return { kind: 'malformed', localBurnRateTokensPerHour, warning: resetConfig.warning ?? 'malformed usage week reset config' };
  }
  const { resetDay, resetLocal } = resetConfig.config;
  const windowStartMs = currentWeeklyWindowStartMs(nowMs, resetDay, resetLocal);
  const anchorsInWindow = anchors.filter((a) => a.scope === anchorScope && a.atMs >= windowStartMs && a.atMs <= nowMs);
  const derived = deriveBurnRateFromAnchors(anchorsInWindow, windowStartMs);
  if (!derived) {
    return { kind: 'no-anchor', localBurnRateTokensPerHour };
  }
  const nextResetMs = nextWeeklyResetMs(nowMs, resetDay, resetLocal);
  const decision = decideProjection(derived.latestPct, derived.latestAtMs, derived.ratePctPerDay, nextResetMs);
  return decision === 'warn'
    ? { kind: 'warn', ratePctPerDay: derived.ratePctPerDay, runOutAtMs: computeProjectedExhaustionMs(derived.latestPct, derived.latestAtMs, derived.ratePctPerDay) }
    : { kind: 'ok', ratePctPerDay: derived.ratePctPerDay };
}
