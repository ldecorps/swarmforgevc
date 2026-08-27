// BL-704: shift / holiday / oncall policy overlay (durable under operator/).

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface HolidayRange {
  start: string;
  end: string;
  reason?: string;
}

export interface OperatorPolicyState {
  shift?: { name: string; startedAtMs: number; until?: string };
  holidays: HolidayRange[];
  oncallId?: string;
}

export const OPERATOR_POLICY_FILENAME = 'operator-policy.json';

export function emptyOperatorPolicy(): OperatorPolicyState {
  return { holidays: [] };
}

export function policyPath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'operator', OPERATOR_POLICY_FILENAME);
}

export function parseHolidayAddArgs(args: string | undefined): HolidayRange | { error: string } {
  const parts = (args ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 1) {
    return { error: 'usage: /holiday add YYYY-MM-DD [YYYY-MM-DD] [reason]' };
  }
  const start = parts[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return { error: 'holiday start must be YYYY-MM-DD' };
  }
  let end = start;
  let reasonParts = parts.slice(1);
  if (parts[1] && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])) {
    end = parts[1];
    reasonParts = parts.slice(2);
  }
  const reason = reasonParts.join(' ').trim() || undefined;
  return { start, end, ...(reason ? { reason } : {}) };
}

export function isDateInHoliday(day: string, holidays: HolidayRange[]): HolidayRange | undefined {
  for (const h of holidays) {
    if (day >= h.start && day <= h.end) {
      return h;
    }
  }
  return undefined;
}

export function todayUtcDate(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function isHolidayQuietToday(state: OperatorPolicyState, nowMs = Date.now()): HolidayRange | undefined {
  return isDateInHoliday(todayUtcDate(nowMs), state.holidays);
}

export function formatHolidayRefuse(holiday: HolidayRange, verb: string): string {
  const reason = holiday.reason ? ` (${holiday.reason})` : '';
  return [
    `Cannot ${verb}: holiday quiet ${holiday.start}–${holiday.end}${reason}.`,
    'Tap Run anyway to proceed, or /holiday clear to remove the range.',
  ].join('\n');
}

export function runAnywayButtons(verb: string, args?: string): Array<Array<{ text: string; callbackData: string }>> {
  const payload = args ? `${verb} ${args}` : verb;
  return [
    [
      { text: 'Run anyway', callbackData: `op:run-anyway:${payload}` },
      { text: 'Cancel', callbackData: 'op:cancel' },
    ],
  ];
}

export function formatHolidayList(state: OperatorPolicyState): string {
  if (state.holidays.length === 0) {
    return 'holiday list: (none)';
  }
  const lines = state.holidays.map((h, i) => {
    const reason = h.reason ? ` — ${h.reason}` : '';
    return `${i + 1}. ${h.start} → ${h.end}${reason}`;
  });
  return ['holiday list:', ...lines].join('\n');
}

export function formatShiftStatus(state: OperatorPolicyState): string {
  if (!state.shift) {
    return 'shift status: (none active)';
  }
  const until = state.shift.until ? ` until ${state.shift.until}` : '';
  return `shift status: ${state.shift.name}${until}`;
}

export function applyHolidayAdd(state: OperatorPolicyState, range: HolidayRange): OperatorPolicyState {
  return { ...state, holidays: [...state.holidays, range] };
}

export function applyHolidayClear(state: OperatorPolicyState, day: string): OperatorPolicyState {
  return {
    ...state,
    holidays: state.holidays.filter((h) => !(day >= h.start && day <= h.end)),
  };
}

export function applyShiftStart(
  state: OperatorPolicyState,
  name: string,
  until: string | undefined,
  nowMs = Date.now()
): OperatorPolicyState {
  return {
    ...state,
    shift: { name, startedAtMs: nowMs, ...(until ? { until } : {}) },
  };
}

export function applyShiftEnd(state: OperatorPolicyState): OperatorPolicyState {
  const next = { ...state };
  delete next.shift;
  return next;
}

export function applyOncall(state: OperatorPolicyState, id: string | undefined): OperatorPolicyState {
  const next = { ...state };
  if (id) {
    next.oncallId = id;
  } else {
    delete next.oncallId;
  }
  return next;
}

export function readOperatorPolicy(repoRoot: string): OperatorPolicyState {
  const file = policyPath(repoRoot);
  if (!fs.existsSync(file)) {
    return emptyOperatorPolicy();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<OperatorPolicyState>;
    return {
      holidays: Array.isArray(raw.holidays) ? raw.holidays : [],
      ...(raw.shift ? { shift: raw.shift } : {}),
      ...(raw.oncallId ? { oncallId: raw.oncallId } : {}),
    };
  } catch {
    return emptyOperatorPolicy();
  }
}

export function writeOperatorPolicy(repoRoot: string, state: OperatorPolicyState): void {
  const file = policyPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

/** Verbs that holiday quiet refuses (BL-698 Q2). */
export function isHolidayBlockedVerb(verb: string): boolean {
  const v = verb.trim().toLowerCase().split(/\s+/)[0] ?? '';
  return (
    v === '/pilot' ||
    v === '/expedite' ||
    v === '/reexpedite' ||
    v === '/autopilot' ||
    v === '/land' ||
    v === '/hydrate' ||
    v === '/mint'
  );
}

/** Alert routing target from /oncall (falls back to principal). */
export function resolveOncallAlertTarget(
  state: OperatorPolicyState,
  principalId?: string
): string | undefined {
  return state.oncallId || principalId || undefined;
}

export function formatOncallAlertLine(state: OperatorPolicyState, principalId?: string): string {
  const target = resolveOncallAlertTarget(state, principalId);
  return target ? `alerts → oncall ${target}` : 'alerts → (no oncall set; use /oncall me)';
}
