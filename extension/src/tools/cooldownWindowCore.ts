// BL-617: pure decision logic for the nightly cooldown window scheduler.
// This is a SCHEDULER over BL-423's existing timed-pause machinery, not new
// pause plumbing - the only new decision here is WHEN to apply/re-apply the
// existing pause, expressed as a pure function of (now, config, pauseState,
// a "this window already handled" marker), no I/O, mirroring
// telegramControlCore.ts's own pure/injected-clock posture.
//
// Config (swarmforge.conf, `config <key> <value>` lines):
//   cooldown_window_enabled true|false   (absent => disabled)
//   cooldown_start_local HH:MM           (absent => 19:00)
//   cooldown_end_local HH:MM             (absent => 07:00)
// Times are local wall-clock on the swarm host (this module reads them via
// the host process's own local Date getters - never UTC) and the window
// may span midnight.

import { parseConfigValue } from '../util/swarmforgeConfig';
import type { PauseState } from './telegramControlCore';

export type LocalTime = { hour: number; minute: number };

export type CooldownConfig = {
  enabled: boolean;
  startLocal: LocalTime;
  endLocal: LocalTime;
};

export type ParsedCooldownConfig = {
  config: CooldownConfig | null;
  malformed: boolean;
  warning?: string;
};

export type CooldownDecision =
  | { action: 'none' }
  | { action: 'apply-pause'; untilMs: number; windowStartMs: number };

const DEFAULT_START: LocalTime = { hour: 19, minute: 0 };
const DEFAULT_END: LocalTime = { hour: 7, minute: 0 };

const LOCAL_TIME_PATTERN = /^([0-9]{1,2}):([0-9]{2})$/;

// Validates "HH:MM", hour 0-23, minute 0-59. Returns null on anything else -
// callers degrade a malformed value to "disabled + loud warning", never a
// crash (same posture as briefing_generation_schedule_lib.bb's
// parse-morning-time).
export function parseLocalTime(value: string | undefined): LocalTime | null {
  if (!value) {
    return null;
  }
  const match = LOCAL_TIME_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

export function parseCooldownConfig(confContent: string): ParsedCooldownConfig {
  const enabledRaw = parseConfigValue(confContent, 'cooldown_window_enabled');
  const enabled = enabledRaw === 'true';
  if (!enabled) {
    return { config: { enabled: false, startLocal: DEFAULT_START, endLocal: DEFAULT_END }, malformed: false };
  }

  const startRaw = parseConfigValue(confContent, 'cooldown_start_local');
  const endRaw = parseConfigValue(confContent, 'cooldown_end_local');
  const startLocal = startRaw === undefined ? DEFAULT_START : parseLocalTime(startRaw);
  const endLocal = endRaw === undefined ? DEFAULT_END : parseLocalTime(endRaw);

  if (!startLocal || !endLocal) {
    return {
      config: null,
      malformed: true,
      warning: `malformed cooldown window config: start=${startRaw ?? '(default)'} end=${endRaw ?? '(default)'}`,
    };
  }

  return { config: { enabled: true, startLocal, endLocal }, malformed: false };
}

function minutesOfDay(time: LocalTime): number {
  return time.hour * 60 + time.minute;
}

export function localMinutesOfDay(nowMs: number): number {
  const now = new Date(nowMs);
  return now.getHours() * 60 + now.getMinutes();
}

// Handles a window spanning midnight (start > end) as well as a same-day
// window (start < end). Start is inclusive, end is exclusive - "19:00"
// opens the window, "07:00" closes it.
export function isWithinWindow(nowMinutes: number, start: LocalTime, end: LocalTime): boolean {
  const startMinutes = minutesOfDay(start);
  const endMinutes = minutesOfDay(end);
  if (startMinutes === endMinutes) {
    return true;
  }
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

// The epoch-ms of the most recent window-open at or before `nowMs`, so a
// midnight-spanning window's early-morning half (e.g. 00:45 for a
// 19:00-07:00 window) still resolves to the PRECEDING calendar day's start
// time - the same window instance as when it opened the evening before.
export function currentWindowStartMs(nowMs: number, start: LocalTime): number {
  const now = new Date(nowMs);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), start.hour, start.minute, 0, 0);
  if (startToday.getTime() <= nowMs) {
    return startToday.getTime();
  }
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  return startYesterday.getTime();
}

// The next occurrence of the end time strictly after `nowMs` - "the next
// 07:00 local boundary", whichever calendar day that lands on.
export function nextWindowCloseMs(nowMs: number, end: LocalTime): number {
  const now = new Date(nowMs);
  const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), end.hour, end.minute, 0, 0);
  if (endToday.getTime() > nowMs) {
    return endToday.getTime();
  }
  const endTomorrow = new Date(endToday);
  endTomorrow.setDate(endTomorrow.getDate() + 1);
  return endTomorrow.getTime();
}

export type DecideCooldownWindowInput = {
  nowMs: number;
  config: CooldownConfig | null;
  pauseState: PauseState;
  lastHandledWindowStartMs: number | undefined;
};

// The one automatic-application-per-window rule (the manual-override rule):
// - disabled/malformed config -> none.
// - outside the window -> none.
// - an ALREADY-active pause (human or otherwise) is never overridden -> none.
// - this window instance was already handled (cooldown-apply or a human
//   resume-now inside the window) -> none.
// - otherwise -> apply-pause until the next window close.
export function decideCooldownWindow(input: DecideCooldownWindowInput): CooldownDecision {
  const { nowMs, config, pauseState, lastHandledWindowStartMs } = input;
  if (!config || !config.enabled) {
    return { action: 'none' };
  }
  if (!isWithinWindow(localMinutesOfDay(nowMs), config.startLocal, config.endLocal)) {
    return { action: 'none' };
  }
  if (pauseState.active) {
    return { action: 'none' };
  }
  const windowStartMs = currentWindowStartMs(nowMs, config.startLocal);
  if (lastHandledWindowStartMs === windowStartMs) {
    return { action: 'none' };
  }
  return { action: 'apply-pause', untilMs: nextWindowCloseMs(nowMs, config.endLocal), windowStartMs };
}
