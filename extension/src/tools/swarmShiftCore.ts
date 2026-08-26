// BL-660: pure three-shift pack definitions — one active swarm_shift drives
// every schedule-derived clock. Mirrors swarm_shift_lib.bb.

import { parseConfigValue } from '../util/swarmforgeConfig';
import type { LocalTime } from './cooldownWindowCore';

export type ShiftName = 'day' | 'evening' | 'night';

const SHIFT_NAMES = new Set<ShiftName>(['day', 'evening', 'night']);

const SHIFT_DEFINITIONS: Record<ShiftName, { start: LocalTime; stop: LocalTime }> = {
  day: { start: { hour: 9, minute: 0 }, stop: { hour: 17, minute: 0 } },
  evening: { start: { hour: 17, minute: 0 }, stop: { hour: 1, minute: 0 } },
  night: { start: { hour: 1, minute: 0 }, stop: { hour: 9, minute: 0 } },
};

export type ResolvedShiftSchedule = {
  shift: ShiftName;
  startLocal: LocalTime;
  stopLocal: LocalTime;
  closureStopLocal: LocalTime;
  cooldownWindowEnabled: true;
  cooldownStartLocal: LocalTime;
  cooldownEndLocal: LocalTime;
};

export function parseSwarmShift(confContent: string): ShiftName | null {
  const raw = parseConfigValue(confContent, 'swarm_shift');
  if (!raw || !SHIFT_NAMES.has(raw as ShiftName)) {
    return null;
  }
  return raw as ShiftName;
}

export function resolveShiftSchedule(confContent: string): ResolvedShiftSchedule | null {
  const shift = parseSwarmShift(confContent);
  if (!shift) {
    return null;
  }
  const { start, stop } = SHIFT_DEFINITIONS[shift];
  return {
    shift,
    startLocal: start,
    stopLocal: stop,
    closureStopLocal: stop,
    cooldownWindowEnabled: true,
    cooldownStartLocal: stop,
    cooldownEndLocal: start,
  };
}

export function longestStoppedGapMinutes(shift: ShiftName): number {
  const { start, stop } = SHIFT_DEFINITIONS[shift];
  const startM = start.hour * 60 + start.minute;
  const stopM = stop.hour * 60 + stop.minute;
  const work = startM < stopM ? stopM - startM : 24 * 60 - startM + stopM;
  return 24 * 60 - work;
}

export function effectiveCloseLocal(input: {
  scheduledStopLocal: LocalTime;
  outageMinutes: number;
  swarmCaused?: boolean;
  capMinutes?: number;
}): LocalTime {
  const cap = input.capMinutes ?? 120;
  if (input.swarmCaused || input.outageMinutes <= 0) {
    return input.scheduledStopLocal;
  }
  const credit = Math.min(input.outageMinutes, cap);
  const base = input.scheduledStopLocal.hour * 60 + input.scheduledStopLocal.minute;
  const total = base + credit;
  return { hour: Math.floor(total / 60) % 24, minute: total % 60 };
}

export function extendedCloseAnnouncementText(input: {
  shift: ShiftName;
  outageMinutes: number;
  scheduledStopLocal: LocalTime;
  effectiveCloseLocal: LocalTime;
}): string {
  return (
    `Extended close (${input.shift}): +${input.outageMinutes}m signature-backed provider outage → ` +
    `${formatLocalTime(input.effectiveCloseLocal)} (scheduled ${formatLocalTime(input.scheduledStopLocal)})`
  );
}

export function formatLocalTime(t: LocalTime): string {
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}
