import * as fs from 'fs';
import { atomicWrite } from '../util/atomicWrite';

/**
 * BL-099: daily-briefing scheduling (the coder's slice - the coordinator's
 * own composition of the briefing content is a separate, role-prompt-owned
 * concern). Decides when a "briefing due" prompt should reach the
 * coordinator's pane: at most once per calendar day, and if the host was
 * down across one or more scheduled times, the next activation still fires
 * exactly once - covering the gap, never bursting one prompt per missed day.
 */

export function utcDayKey(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * True at/after briefingHourUtc on any day whose UTC day-key does not match
 * lastFiredDayKey. Comparing day-keys (not just "has it been 24h") is what
 * makes a multi-day gap collapse into a single catch-up fire: whatever day
 * it actually is now is compared only against the day the briefing last
 * fired, never against each day skipped in between.
 */
export function isBriefingDue(
  nowMs: number,
  briefingHourUtc: number,
  lastFiredDayKey: string | null
): boolean {
  const now = new Date(nowMs);
  const scheduledToday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    briefingHourUtc,
    0,
    0,
    0
  );
  if (nowMs < scheduledToday) {
    return false;
  }
  return lastFiredDayKey !== utcDayKey(nowMs);
}

export interface BriefingScheduleState {
  lastFiredDayKey: string | null;
}

export function loadBriefingScheduleState(filePath: string): BriefingScheduleState {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return { lastFiredDayKey: typeof parsed?.lastFiredDayKey === 'string' ? parsed.lastFiredDayKey : null };
  } catch {
    return { lastFiredDayKey: null };
  }
}

export function recordBriefingFired(filePath: string, dayKey: string): void {
  atomicWrite(filePath, JSON.stringify({ lastFiredDayKey: dayKey }, null, 2));
}

export interface BriefingSchedulerConfig {
  briefingHourUtc: number;
  scheduleStatePath: string;
}

export interface BriefingSchedulerCallbacks {
  getNowMs: () => number;
  onBriefingDue: () => void;
}

/**
 * scheduleTick/clearTick are injected so this is testable without a real
 * timer (no-real-timers-in-tests rule); production callers pass
 * setInterval/clearInterval, mirroring startPeriodicStateDump.
 */
export function startBriefingScheduler<H>(
  config: BriefingSchedulerConfig,
  callbacks: BriefingSchedulerCallbacks,
  intervalMs: number,
  scheduleTick: (fn: () => void, ms: number) => H,
  clearTick: (handle: H) => void
): () => void {
  const tick = (): void => {
    const nowMs = callbacks.getNowMs();
    const state = loadBriefingScheduleState(config.scheduleStatePath);
    if (isBriefingDue(nowMs, config.briefingHourUtc, state.lastFiredDayKey)) {
      callbacks.onBriefingDue();
      recordBriefingFired(config.scheduleStatePath, utcDayKey(nowMs));
    }
  };
  const handle = scheduleTick(tick, intervalMs);
  return () => clearTick(handle);
}
