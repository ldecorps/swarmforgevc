/**
 * BL-1429 (human directive 2026-09-05, "stop everything and fix failing
 * tests before doing anything else" - made proportional): a pure fold of
 * BL-1428's standing-red register report into an Article 3.5 throttle
 * signal. The register is read through standing_red_register_cli.bb
 * (BL-1428 invariant 1: never a second TSV parser here); the two
 * thresholds through the SAME `config <key> <value>` reader
 * active_backlog_max_depth's own conf keys use.
 *
 * Cap 1 only, never 0 - the human ruled a soft stop, not a freeze. A cap
 * of 0 stays BL-432's rework diagnosis's own "severe" verdict, an
 * entirely separate signal this module never touches or competes with
 * except via emit-throttle-recommendation.ts's own min-of-two fold.
 */
import { execFileSync } from 'child_process';
import * as path from 'path';
import { readConfigValue } from '../util/swarmforgeConfig';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'standing_red_register_cli.bb');

export const DEFAULT_STANDING_RED_MAX_COUNT = 10;
export const DEFAULT_STANDING_RED_MAX_AGE_DAYS = 7;

export type StandingRedThrottleSignal = 'count' | 'age' | 'unowned';

export interface StandingRedRegisterReport {
  count: number;
  oldest_age_days: number | null;
  unowned: unknown[];
}

export interface StandingRedRecommendation {
  recommendedCap: 1;
  signal: StandingRedThrottleSignal;
}

export interface StandingRedThresholds {
  maxCount: number;
  maxAgeDays: number;
}

// A human-readable phrase for each signal, shared by the throttle change
// log (emit-throttle-recommendation.ts) and anything else that needs to
// say WHY intake is throttled - one place, so the log wording and any
// future reader (briefing burn section, coordinator prompt) never drift
// into two different names for the same cause.
export function describeStandingRedSignal(signal: StandingRedThrottleSignal): string {
  switch (signal) {
    case 'count':
      return 'the red count';
    case 'age':
      return "the oldest red's age";
    case 'unowned':
      return 'an unowned red';
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readStandingRedThresholds(targetRepoPath: string): StandingRedThresholds {
  return {
    maxCount: parsePositiveInt(readConfigValue(targetRepoPath, 'standing_red_max_count'), DEFAULT_STANDING_RED_MAX_COUNT),
    maxAgeDays: parsePositiveInt(readConfigValue(targetRepoPath, 'standing_red_max_age_days'), DEFAULT_STANDING_RED_MAX_AGE_DAYS),
  };
}

/**
 * Pure: the register report -> the throttle recommendation, or null when
 * every threshold is clear. Checked in a fixed priority (unowned, count,
 * age) purely to pick ONE deterministic `signal` when more than one
 * threshold is crossed at once - the recommended cap is the same 1
 * whichever fires, so this ordering never changes the OUTCOME, only which
 * cause gets named.
 */
export function standingRedSignal(
  report: StandingRedRegisterReport,
  thresholds: StandingRedThresholds
): StandingRedRecommendation | null {
  if (report.unowned.length > 0) {
    return { recommendedCap: 1, signal: 'unowned' };
  }
  if (report.count > thresholds.maxCount) {
    return { recommendedCap: 1, signal: 'count' };
  }
  if (report.oldest_age_days !== null && report.oldest_age_days > thresholds.maxAgeDays) {
    return { recommendedCap: 1, signal: 'age' };
  }
  return null;
}

function isStandingRedRegisterReport(value: unknown): value is StandingRedRegisterReport {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.count === 'number' &&
    (v.oldest_age_days === null || typeof v.oldest_age_days === 'number') &&
    Array.isArray(v.unowned)
  );
}

/**
 * Impure: shells to BL-1428's register CLI (never a second TSV parser),
 * degrading to null (no standing-red signal available) on any failure -
 * missing bb, a non-zero exit, or unparseable output - the same
 * guarded-shell-out-and-degrade convention contextTelemetryGate.ts's own
 * runCli uses for a sibling bb-backed reader.
 */
export function readStandingRedReport(targetRepoPath: string): StandingRedRegisterReport | null {
  try {
    const out = execFileSync('bb', [CLI, targetRepoPath], { encoding: 'utf8' });
    const parsed: unknown = JSON.parse(out);
    return isStandingRedRegisterReport(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Composition point: read the report and thresholds, fold to a
 * recommendation. Null when the CLI fails or is absent (degrade, never
 * throw - the emitter must still produce a rework-only recommendation)
 * or every threshold is clear.
 */
export function computeStandingRedRecommendation(targetRepoPath: string): StandingRedRecommendation | null {
  const report = readStandingRedReport(targetRepoPath);
  if (!report) {
    return null;
  }
  return standingRedSignal(report, readStandingRedThresholds(targetRepoPath));
}
